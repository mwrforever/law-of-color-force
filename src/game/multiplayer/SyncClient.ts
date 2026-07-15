/**
 * SyncClient.ts —— 客户端（发输入/喷涂、收快照做插值/预测、弱网重连）
 * 对应 multiplayer-gdd §5.2 / §5.3。host 权威；本端只发输入、收状态，渲染用插值+预测。
 *
 * 注意：真实 WebSocket 连接走「自托管中继」（技术决策④）。connect(url) 给出传输抽象与分发骨架，
 * 不实现完整网络层；TODO 标明需接入自托管 ws 服务（微信小游戏用 wx.connectSocket）。
 */
import { _decorator, Component, Node, Vec3 } from 'cc';
import { PHYS } from '../color-physics/ColorPhysicsProfile';
import { ColorResolver } from '../color-physics/ColorResolver';
import { PaintableBody } from '../color-physics/PaintableBody';
import {
  NetMessage, Snapshot, ClientMsg, MsgInput, MsgSpray, encode, decode,
} from './protocol';

const { ccclass, property } = _decorator;

// ===== 传输抽象（微信小游戏 wx.connectSocket / 浏览器 WebSocket）=====
export interface NetSocket {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
}

/** 建立连接：微信小游戏用 wx.connectSocket，本地/浏览器测试用 WebSocket */
export function connectSocket(url: string): NetSocket {
  const wxAny = (globalThis as any).wx;
  if (wxAny && typeof wxAny.connectSocket === 'function') {
    const task = wxAny.connectSocket({ url });
    return {
      send: (d) => task.send({ data: d }),
      close: () => task.close(),
      onMessage: (cb) => task.onMessage((r: any) => cb(typeof r.data === 'string' ? r.data : '')),
      onClose: (cb) => task.onClose(() => cb()),
    };
  }
  // TODO: 校验浏览器 WebSocket 签名（ws.onopen 后再 send）
  const ws = new WebSocket(url);
  return {
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onMessage: (cb) => { ws.onmessage = (e) => cb(typeof e.data === 'string' ? e.data : ''); },
    onClose: (cb) => { ws.onclose = () => cb(); },
  };
}

// ===== 场景绑定（由房间/场景层把网络态映射到本地节点）=====
export interface SceneBinder {
  localPlayerId: string;
  getPlayerNode(id: string): Node | null;
  getPaintable(id: string): PaintableBody | null;
}

// ===== 快照插值缓冲 =====
interface Stamped { snap: Snapshot; t: number; }

class SnapshotBuffer {
  private buf: Stamped[] = [];
  push(snap: Snapshot, t: number) {
    this.buf.push({ snap, t });
    if (this.buf.length > 24) this.buf.shift();
  }
  sample(renderTime: number): Snapshot | null {
    if (this.buf.length === 0) return null;
    if (this.buf.length === 1 || renderTime <= this.buf[0].t) return this.buf[0].snap;
    for (let i = this.buf.length - 1; i > 0; i--) {
      const a = this.buf[i - 1], b = this.buf[i];
      if (renderTime >= a.t && renderTime <= b.t) {
        const k = (renderTime - a.t) / Math.max(1e-4, b.t - a.t);
        return lerpSnap(a.snap, b.snap, k);
      }
    }
    return this.buf[this.buf.length - 1].snap;
  }
}

function lerpSnap(a: Snapshot, b: Snapshot, k: number): Snapshot {
  const lp = a.players.map((pa) => {
    const pb = b.players.find((x) => x.id === pa.id) ?? pa;
    return { ...pa, pos: lerp3(pa.pos, pb.pos, k), vel: lerp3(pa.vel, pb.vel, k) };
  });
  const lo = a.objects.map((oa) => {
    const ob = b.objects.find((x) => x.id === oa.id) ?? oa;
    return { ...oa, pos: lerp3(oa.pos, ob.pos, k), vel: lerp3(oa.vel, ob.vel, k) };
  });
  return { ...a, players: lp, objects: lo, tick: b.tick };
}
function lerp3(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

@ccclass('SyncClient')
export class SyncClient extends Component {
  @property({ type: Number }) moveSpeed = 6; // 本地预测用（需与 host 一致）

  socket: NetSocket | null = null;
  binder: SceneBinder | null = null;

  // 回调钩子（UI 阶段绑定）
  onJoinAck?: (youAreHost: boolean, roster: string[], arenaId: string) => void;
  onWin?: (winnerId: string, reason: string) => void;
  onDisconnect?: () => void;

  private _roomId = '';
  private _token = '';
  private _youAreHost = false;
  private _buffer = new SnapshotBuffer();
  private _lastInput: MsgInput | null = null;
  private _predPos = new Vec3();
  private _predVel = new Vec3();
  private _connected = false;

  /** 连接自托管中继并加入房间（技术决策④：自托管 ws，非 CloudBase） */
  connect(url: string, roomId: string, token: string) {
    this._roomId = roomId;
    this._token = token;
    this.socket = connectSocket(url);
    this.socket.onMessage((raw) => this._onMessage(raw));
    this.socket.onClose(() => { this._connected = false; this.onDisconnect?.(); });
    this._send({ type: 'c2s_join', roomId, token });
    this._connected = true;
  }

  /** 弱网重连：用同一 roomId+token 重连，中继补发全量状态（GDD §5.3） */
  reconnect() {
    // TODO: 重连后由 s2c_join_ack 补发全量状态，客户端无感恢复；host 掉线由中继指定新 host
    if (this._roomId) this.connect('', this._roomId, this._token);
  }

  sendInput(seq: number, moveDir: [number, number], jump: boolean, buttons: number) {
    const m: MsgInput = { type: 'c2s_input', seq, moveDir, jump, buttons };
    this._lastInput = m;
    // 本地预测：立即反映（host 快照校正）
    const [dx, dz] = moveDir; const len = Math.hypot(dx, dz) || 1;
    this._predVel.set((dx / len) * this.moveSpeed, 0, (dz / len) * this.moveSpeed);
    this._send(m);
  }

  sendSpray(targetKind: 'object' | 'opponent' | 'self', targetId: string, primary: 'R' | 'B' | 'Y', hitPoint: [number, number, number]) {
    const m: MsgSpray = { type: 'c2s_spray', targetKind, targetId, primary, hitPoint };
    this._send(m);
  }

  update(dt: number) {
    if (!this.binder || !this._connected) return;
    const now = Date.now() / 1000;
    const renderTime = now - PHYS.INTERP_DELAY;
    const snap = this._buffer.sample(renderTime);
    if (!snap) return;

    // 本地玩家预测积分 + 服务器轻校正
    if (this._lastInput) {
      this._predPos.x += this._predVel.x * dt;
      this._predPos.z += this._predVel.z * dt;
    }
    const me = snap.players.find((p) => p.id === this.binder!.localPlayerId);
    if (me) {
      this._predPos.x += (me.pos[0] - this._predPos.x) * 0.2;
      this._predPos.z += (me.pos[2] - this._predPos.z) * 0.2;
    }
    this._applyToScene(snap);
  }

  // ---- 内部 ----
  private _onMessage(raw: string) {
    const msg = decode(raw);
    switch (msg.type) {
      case 's2c_join_ack':
        this._youAreHost = msg.youAreHost;
        this.onJoinAck?.(msg.youAreHost, msg.roster, msg.arenaId);
        break;
      case 's2c_snapshot':
        this._buffer.push(msg.snap, Date.now() / 1000);
        break;
      case 's2c_win':
        this.onWin?.(msg.winnerId, msg.reason);
        break;
      case 's2c_leave':
        if (msg.newHostId && this.binder?.localPlayerId === msg.newHostId) this._youAreHost = true;
        break;
    }
    void this._youAreHost;
  }

  private _applyToScene(snap: Snapshot) {
    if (!this.binder) return;
    const localId = this.binder.localPlayerId;
    for (const ps of snap.players) {
      const node = this.binder.getPlayerNode(ps.id);
      if (!node) continue;
      if (ps.id === localId) {
        node.setWorldPosition(this._predPos.x, this._predPos.y, this._predPos.z);
      } else {
        node.setWorldPosition(ps.pos[0], ps.pos[1], ps.pos[2]);
      }
    }
    for (const os of snap.objects) {
      // 收端 resolve 复算物理（state/frozen 由 primaryStack 推导，省带宽且一致）
      void ColorResolver.resolve(os.primaryStack);
      this.binder.getPaintable(os.id)?.setStack(os.primaryStack);
    }
  }

  private _send(msg: NetMessage | ClientMsg) {
    if (this.socket) this.socket.send(encode(msg as NetMessage));
  }
}
