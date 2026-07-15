/**
 * protocol.ts —— host 权威状态同步协议（消息类型 + 编解码）
 * 对应 multiplayer-gdd §5。关键原则：状态只同步 primaryStack，收端用 ColorResolver 复算物理，
 * 省带宽且保证一致（色彩物理 §3 确定性）。
 *
 * 注：本文件为「协议骨架」——编解码起步用 JSON；高频快照后续可换 Float32Array 二进制紧凑化（见 TODO）。
 */
import type { Primary } from '../color-physics/ColorPhysicsProfile';
import type { ArenaConfig } from '../level/LevelTypes';

// ===== 快照态（仅同步 primaryStack；state/frozen 由收端 resolve 复算）=====
export interface PlayerSnap {
  id: string;
  pos: [number, number, number];
  vel: [number, number, number];
  primaryStack: Primary[];   // 收端 ColorResolver.resolve -> state / frozen
  crownHolder: boolean;
  crownSec: number;          // 累计持冠秒
  iframe: number;            // 剩余无敌时间（防连喷）
}
export interface ObjectSnap {
  id: string;
  pos: [number, number, number];
  vel: [number, number, number];
  primaryStack: Primary[];
}
export interface Snapshot {
  tick: number;
  players: PlayerSnap[];
  objects: ObjectSnap[];
  crown: { holder: string | null; sec: number } | null;
  timer: number;             // 单局剩余秒
  youAreHost: boolean;       // 片段冗余，便于客户端快速判权
}

// ===== 消息定义 =====
export interface MsgJoin      { type: 'c2s_join';      roomId: string; token: string; profile?: unknown; }
export interface MsgLeave     { type: 'c2s_leave'; }
export interface MsgInput     { type: 'c2s_input';     seq: number; moveDir: [number, number]; jump: boolean; buttons: number; }
export interface MsgSpray     { type: 'c2s_spray';     targetKind: 'object' | 'opponent' | 'self'; targetId: string; primary: Primary; hitPoint: [number, number, number]; }
export interface MsgAck       { type: 'c2s_ack';       lastSnapshotTick: number; }

export interface MsgJoinAck   { type: 's2c_join_ack';  youAreHost: boolean; roster: string[]; arenaId: string; }
export interface MsgLeaveS2C  { type: 's2c_leave';     playerId: string; newHostId?: string; }
export interface MsgSnapshot  { type: 's2c_snapshot';  snap: Snapshot; }
export interface MsgWin       { type: 's2c_win';       winnerId: string; reason: string; }

export type ClientMsg = MsgJoin | MsgLeave | MsgInput | MsgSpray | MsgAck;
export type ServerMsg = MsgJoinAck | MsgLeaveS2C | MsgSnapshot | MsgWin;
export type NetMessage = ClientMsg | ServerMsg;

// ===== 编解码 =====
// TODO: 性能优化——高频快照改用二进制（Float32Array + DataView）编解码，省带宽
export function encode(msg: NetMessage): string { return JSON.stringify(msg); }
export function decode(raw: string): NetMessage {
  return JSON.parse(raw) as NetMessage;
}

export type { ArenaConfig };
