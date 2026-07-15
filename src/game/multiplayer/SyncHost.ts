/**
 * SyncHost.ts —— host 客户端权威端（房主）
 * 对应 multiplayer-gdd §5 / §4 / §3。接收输入/喷涂、跑权威逻辑、15-20Hz 发 StateSnapshot、
 * 比分校验（皇冠累计15s）、胜者判定。
 *
 * 重要说明：本文件是「权威逻辑骨架」。真实物理权威应让 host 端跑 ColorForceSystem + 各物体
 * RigidBody 完整模拟（与单人完全一致）。此处用「逻辑级积分 + 定身禁动」保证协议/校验/胜负闭环可跑，
 * 便于先联调；物理接管为 TODO。无论哪种实现，状态只同步 primaryStack，收端 resolve 复算。
 */
import { _decorator, Component, Vec3 } from 'cc';
import { Primary, PHYS } from '../color-physics/ColorPhysicsProfile';
import { ColorResolver } from '../color-physics/ColorResolver';
import { ArenaConfig } from '../level/LevelTypes';
import {
  ClientMsg, MsgSpray, MsgInput, NetMessage, PlayerSnap, ObjectSnap, Snapshot, encode,
} from './protocol';
import type { NetSocket } from './SyncClient';
import { PaintableBody } from '../color-physics/PaintableBody';

const { ccclass, property } = _decorator;

interface PlayerAuth {
  id: string;
  pos: Vec3;
  vel: Vec3;
  primaryStack: Primary[];
  frozen: boolean;
  iframe: number;       // 剩余无敌
  crownSec: number;     // 累计持冠秒
  selfDyeTimer: number; // 自染剩余
  paintLeft: number;    // 预算（多人每人 20）
  alive: boolean;
}
interface ObjectAuth { id: string; primaryStack: Primary[]; }

@ccclass('SyncHost')
export class SyncHost extends Component {
  @property({ type: Number }) snapshotHz = 18;   // 15-20Hz（GDD §5.2）
  @property({ type: Number }) moveSpeed = 6;     // 逻辑移动速度（骨架，真实用物理）

  arena: ArenaConfig | null = null;
  socket: NetSocket | null = null;              // 由 connect() 注入（见 SyncClient.connectSocket）

  private players = new Map<string, PlayerAuth>();
  private objects = new Map<string, ObjectAuth>();
  private sceneBodies = new Map<string, PaintableBody>(); // 可选：用于把权威态推回场景视觉
  private crownHolder: string | null = null;
  private tick = 0;
  private roundTimer = PHYS.ROUND_TIME;
  private _acc = 0;
  private _winner: { id: string; reason: string } | null = null;

  onLoad() {
    if (this.arena) this.roundTimer = PHYS.ROUND_TIME;
    // TODO: 真实物理权威——此处应启动/复用 ColorForceSystem；现用逻辑积分骨架。
    // 索引场景内可染色体（可选，用于视觉同步）
    const bodies = this.node.getComponentsInChildren(PaintableBody);
    for (const b of bodies) this.sceneBodies.set(b.node.name, b);
  }

  /** 让 host 端可染色体与权威对象态对齐（视觉用，非必需） */
  bindSceneObject(id: string, body: PaintableBody) { this.sceneBodies.set(id, body); }

  /** 接收客户端消息（由 socket 层分发） */
  onClientMessage(fromId: string, msg: ClientMsg) {
    if (this._winner) return;
    switch (msg.type) {
      case 'c2s_join':  this._addPlayer(fromId); break;
      case 'c2s_leave': this._removePlayer(fromId); break;
      case 'c2s_input': this._applyInput(fromId, msg); break;
      case 'c2s_spray': this._validateAndApplySpray(fromId, msg); break;
      // c2s_ack：插值缓冲确认，骨架暂不处理
    }
  }

  update(dt: number) {
    if (this._winner || !this.arena) return;
    this.roundTimer -= dt;

    for (const p of this.players.values()) {
      const state = ColorResolver.resolve(p.primaryStack);
      p.frozen = state === 'PURPLE'; // 紫=定身，输入忽略
      if (p.frozen) { p.vel.set(0, 0, 0); }
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      if (p.iframe > 0) p.iframe = Math.max(0, p.iframe - dt);
      if (p.selfDyeTimer > 0) {
        p.selfDyeTimer -= dt;
        if (p.selfDyeTimer <= 0) this._expireSelfDye(p);
      }
    }

    this._updateCrown(dt);

    const w = this._evaluateWin();
    if (w) { this._winner = w; this._sendWin(w); return; }
    if (this.roundTimer <= 0) {
      const lead = this._leaderByCrown();
      this._sendWin(lead
        ? { id: lead, reason: 'timeout_crown' }
        : { id: this._firstAlive() ?? '', reason: 'timeout' });
      return;
    }

    // 快照（15-20Hz）
    this._acc += dt;
    const interval = 1 / this.snapshotHz;
    while (this._acc >= interval) {
      this._acc -= interval;
      this._broadcastSnapshot();
    }
  }

  // ---- 玩家/对象权威态 ----
  private _addPlayer(id: string) {
    if (this.players.has(id)) return;
    const spawn = this.arena?.spawns[this.players.size % (this.arena?.spawns.length || 1)];
    this.players.set(id, {
      id,
      pos: new Vec3(spawn?.[0] ?? 0, spawn?.[1] ?? 1, spawn?.[2] ?? 0),
      vel: new Vec3(),
      primaryStack: [],
      frozen: false,
      iframe: 0,
      crownSec: 0,
      selfDyeTimer: 0,
      paintLeft: this.arena?.paintBudgetPerPlayer ?? PHYS.PAINT_BUDGET_MULTI,
      alive: true,
    });
  }
  private _removePlayer(id: string) {
    this.players.delete(id);
    if (this.crownHolder === id) this.crownHolder = null;
  }

  private _applyInput(id: string, m: MsgInput) {
    const p = this.players.get(id);
    if (!p || p.frozen) return; // 定身忽略输入
    const [dx, dz] = m.moveDir;
    const len = Math.hypot(dx, dz) || 1;
    p.vel.set((dx / len) * this.moveSpeed, 0, (dz / len) * this.moveSpeed);
    // jump / buttons：骨架未接物理，预留
  }

  private _validateAndApplySpray(fromId: string, m: MsgSpray) {
    const p = this.players.get(fromId);
    if (!p || p.frozen) return;
    if (p.paintLeft <= 0) return; // 预算防护（GDD §3.2）

    if (m.targetKind === 'self') {
      this._pushPrimary(p.primaryStack, m.primary);
      p.paintLeft--;
      // 自染时限由客户端 SelfDyeController 驱动；host 仅记录冻结上限
      if (ColorResolver.resolve(p.primaryStack) === 'PURPLE') {
        p.selfDyeTimer = Math.min(PHYS.SELF_DYE_DURATION, PHYS.FREEZE_CAP);
      }
      return;
    }

    if (m.targetKind === 'opponent') {
      const tgt = this.players.get(m.targetId);
      if (!tgt) return;
      if (tgt.iframe > 0) return;                                  // 命中无敌窗口拒绝（GDD §3.2 hitIFrame）
      // TODO: 真实校验——c2s_spray 应校验目标在射线范围内（host 重放射线或用 hitPoint 距离钳制）
      this._pushPrimary(tgt.primaryStack, m.primary);
      tgt.iframe = this.arena?.antiAbuse.hitIFrame ?? 1.5;         // 施加无敌窗口
      p.paintLeft--;
      return;
    }

    // targetKind === 'object'（干扰场景物体）
    const obj = this.objects.get(m.targetId) ?? this._ensureObject(m.targetId);
    this._pushPrimary(obj.primaryStack, m.primary);
    p.paintLeft--;
    // 推回场景视觉（可选）
    this.sceneBodies.get(m.targetId)?.setStack(obj.primaryStack);
  }

  private _expireSelfDye(p: PlayerAuth) {
    // 自染到期：弹出最后一层（简化：弹栈顶）
    if (p.primaryStack.length > 0) p.primaryStack.pop();
    // TODO: 维护 playerId<->bodyId 映射，把权威栈推回该玩家场景节点（视觉同步）
  }

  private _ensureObject(id: string): ObjectAuth {
    let o = this.objects.get(id);
    if (!o) { o = { id, primaryStack: [] }; this.objects.set(id, o); }
    return o;
  }

  private _pushPrimary(stack: Primary[], p: Primary) {
    const i = stack.indexOf(p);
    if (i >= 0) stack.splice(i, 1);
    stack.push(p);
  }

  // ---- 皇冠 / 胜负 ----
  private _updateCrown(dt: number) {
    if (!this.arena?.crown) return;
    const [cx, cy, cz] = this.arena.crown.spawn;
    let holder: string | null = null;
    let best = Infinity;
    for (const p of this.players.values()) {
      const d = Vec3.distance(p.pos, new Vec3(cx, cy, cz));
      if (d <= PHYS.CROWN_RADIUS && d < best) { best = d; holder = p.id; }
    }
    this.crownHolder = holder;
    if (holder) {
      const p = this.players.get(holder)!;
      p.crownSec += dt;
    }
  }
  private _evaluateWin(): { id: string; reason: string } | null {
    if (!this.arena?.crown) return null;
    const winHold = this.arena.crown.winHoldSec;
    for (const p of this.players.values()) {
      if (p.crownSec >= winHold) return { id: p.id, reason: 'crown_hold' };
    }
    return null;
  }
  private _leaderByCrown(): string | null {
    let best: string | null = null; let bestSec = -1;
    for (const p of this.players.values()) if (p.crownSec > bestSec) { bestSec = p.crownSec; best = p.id; }
    return best;
  }
  private _firstAlive(): string | null {
    for (const p of this.players.values()) if (p.alive) return p.id;
    return null;
  }

  // ---- 快照广播 ----
  private _broadcastSnapshot() {
    const snap: Snapshot = {
      tick: this.tick++,
      youAreHost: true,
      timer: Math.max(0, this.roundTimer),
      crown: this.arena?.crown ? { holder: this.crownHolder, sec: this.crownHolder ? (this.players.get(this.crownHolder)?.crownSec ?? 0) : 0 } : null,
      players: [] as PlayerSnap[],
      objects: [] as ObjectSnap[],
    };
    for (const p of this.players.values()) {
      snap.players.push({
        id: p.id,
        pos: [p.pos.x, p.pos.y, p.pos.z],
        vel: [p.vel.x, p.vel.y, p.vel.z],
        primaryStack: p.primaryStack.slice(),
        crownHolder: this.crownHolder === p.id,
        crownSec: p.crownSec,
        iframe: p.iframe,
      });
    }
    for (const o of this.objects.values()) {
      snap.objects.push({
        id: o.id,
        pos: [0, 0, 0], // TODO: 物体位置由场景/物理提供；骨架未跟踪
        vel: [0, 0, 0],
        primaryStack: o.primaryStack.slice(),
      });
    }
    this._send({ type: 's2c_snapshot', snap });
  }

  private _sendWin(w: { id: string; reason: string }) {
    this._send({ type: 's2c_win', winnerId: w.id, reason: w.reason });
  }

  private _send(msg: NetMessage) {
    if (this.socket) this.socket.send(encode(msg));
  }
}
