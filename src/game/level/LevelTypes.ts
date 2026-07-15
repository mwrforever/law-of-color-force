/**
 * LevelTypes.ts —— 单人解谜关卡 + 多人竞技场 数据 schema
 * 对应 level-system-gdd §2~§7。纯类型/数据，无引擎依赖（仅依赖 color-physics 的基础类型）。
 */
import { ColorState } from '../color-physics/ColorPhysicsProfile';

export type Vec3Tuple = [number, number, number];

export type ObjectTag =
  | 'movable' | 'paintable' | 'goal' | 'hazard' | 'trigger' | 'crown' | 'checkpoint';

export interface SceneObjectDef {
  id: string;
  prefab: string;          // 编辑器/资源名（实例化在美术阶段回填）
  position: Vec3Tuple;
  baseColor: ColorState;   // 橡皮擦终点态
  tags?: ObjectTag[];
}

export type ObjectiveType = 'REACH' | 'FREEZE_PASS' | 'PAINT_WITHIN' | 'COMBO' | 'AVOID';

interface BaseObjective { type: ObjectiveType; id?: string; }

export interface ReachObjective extends BaseObjective {
  type: 'REACH';
  target: string;   // 目标物体 id
  goal: string;     // 目标区 id
  radius?: number;  // 命中容差，默认 1.0
}
export interface FreezePassObjective extends BaseObjective {
  type: 'FREEZE_PASS';
  hazard: string;   // 需被定身的危害体 id
  passZone: string; // 玩家需通过的区 id
  radius?: number;  // passZone 容差，默认 1.5
}
export interface PaintWithinObjective extends BaseObjective {
  type: 'PAINT_WITHIN';
  target: string;
  requiredColor: ColorState; // 需达成的复合色（如 GREEN=蓝+黄）
  zone?: string;             // 可选：需位于该区内
  radius?: number;
}
export interface ComboObjective extends BaseObjective {
  type: 'COMBO';
  objectives: Objective[];   // 全部同时成立
}
export interface AvoidObjective extends BaseObjective {
  type: 'AVOID';
  target: string;
  forbiddenZone: string;
  radius?: number;
}
export type Objective =
  | ReachObjective | FreezePassObjective | PaintWithinObjective
  | ComboObjective | AvoidObjective;

export interface TimedDyeDef {
  trigger: string;            // 如 'ENTER_ZONE:triggerPad01'
  target: string;
  requiredColor: ColorState;
  duration: number;           // 秒
  onFail: 'RETRY' | 'FAIL';
}

export interface StarRules {
  threeStar: { maxPaintUsed: number };
  twoStar: { maxPaintUsed: number };
}

export type FailCondition =
  | 'OBJECT_FELL_IN_PIT' | 'TIMED_DYE_TIMEOUT' | 'OUT_OF_BOUNDS' | string;

export interface LevelData {
  id: string;
  chapter: number;
  name: string;
  sceneObjects: SceneObjectDef[];
  objectives: Objective[];
  paintBudget: number;
  timedDye: TimedDyeDef | null;
  hints: string[];
  starRules: StarRules;
  failConditions: FailCondition[];
}

// ===== 多人竞技场配置（复用同一套色彩物理）=====
export type GameMode = 'SOLO' | 'CROWN' | 'RACE';

export interface ArenaConfig {
  arenaId: string;
  mode: GameMode;
  bounds: { min: Vec3Tuple; max: Vec3Tuple };       // kill-plane 复位边界
  spawns: Vec3Tuple[];                              // 2-4 出生点
  crown?: { spawn: Vec3Tuple; winHoldSec: number }; // 皇冠 + 累计持有秒
  race?: { checkpoints: Vec3Tuple[]; goal: Vec3Tuple };
  disruptZones?: { pos: Vec3Tuple; radius: number; effect: string }[];
  paintBudgetPerPlayer: number;
  antiAbuse: { freezeCap: number; hitIFrame: number; selfDyeCooldown: number };
}
