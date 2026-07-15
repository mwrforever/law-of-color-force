/**
 * ColorPhysicsProfile.ts —— 《色力法则》色彩物理「数据层」
 * 对应 color-physics-gdd §2 / §9。所有「颜色 → 物理参数」的锁定值集中在此，便于真机微调。
 *
 * 设计支柱（GDD §1）：可读即可信 / 确定性可同步 / 改造可回退。
 * 落地约束（GDD §7）：cannon 无原生 per-body gravityScale，故由 ColorForceSystem 每步 applyForce。
 */
import { Vec3 } from 'cc';

// ===== 基础类型（与 color-physics-gdd §9 一致）=====
export type Primary = 'R' | 'B' | 'Y'; // 红 / 蓝 / 黄 三原色
export type ColorState =
  | 'NEUTRAL' | 'RED' | 'BLUE' | 'YELLOW'
  | 'PURPLE' | 'ORANGE' | 'GREEN' | 'WHITE';

/** 单物体物理档案：由 ColorResolver 解析结果映射到 cannon body 的可应用参数 */
export interface ColorPhysicsProfile {
  state: ColorState;
  gravityMultiplier: number; // m_g：逐体重力倍率
  buoyancyAccel: number;     // a_b：向上浮力加速度 (m/s²)，向上为正
  restitution: number;       // e：碰撞弹性系数 0~1
  isFrozen: boolean;         // 是否定身（切 STATIC）
  linearDamping: number;     // 稳定性扩展（GDD §7.2/§8，非 §9 原始字段，用于防能量发散/漂走）
  angularDamping: number;
}

// ===== 锁定常量（来自 GDD / DESIGN-DECISIONS，集中微调）=====
export const PHYS = {
  G: 9.8,                    // 世界基准重力 (m/s²)
  MAX_SPEED: 22,             // 限速防穿透 (m/s)（GDD §8 红线）
  FREEZE_CAP: 2.5,           // 紫定身单次上限 (s)
  SELF_DYE_DURATION: 3.0,    // 自染持续 (s)
  SELF_DYE_COOLDOWN: 1.0,    // 自染冷却 (s)
  SPRAY_RADIUS: 0.6,         // 喷涂球形覆盖半径 (m)
  PAINT_BUDGET_SOLO: 30,     // 单人关预算（次）
  PAINT_BUDGET_MULTI: 20,    // 多人每人预算（次）
  CROWN_WIN_HOLD: 15,        // 皇冠累计持有胜 (s)
  ROUND_TIME: 120,           // 单局上限 (s)
  SNAPSHOT_HZ_MIN: 15,
  SNAPSHOT_HZ_MAX: 20,
  INTERP_DELAY: 0.12,        // 客户端插值缓冲 (s)
  CROWN_RADIUS: 1.5,         // 皇冠拾取/持有半径 (m)，预留可调
} as const;

// ===== 8 态预设表（GDD §2，数值为起步建议值，真机微调）=====
// PRIMARY 集合 -> 态：
//  ∅=NEUTRAL  R=RED  B=BLUE  Y=YELLOW  R+B=PURPLE(定身)  R+Y=ORANGE  B+Y=GREEN  R+B+Y=WHITE(中和)
export const COLOR_PROFILES: Record<ColorState, ColorPhysicsProfile> = {
  NEUTRAL: { state: 'NEUTRAL', gravityMultiplier: 1.0, buoyancyAccel: 0.0, restitution: 0.20, isFrozen: false, linearDamping: 0.0, angularDamping: 0.0 },
  RED:     { state: 'RED',     gravityMultiplier: 2.0, buoyancyAccel: 0.0, restitution: 0.20, isFrozen: false, linearDamping: 0.05, angularDamping: 0.1 },
  BLUE:    { state: 'BLUE',    gravityMultiplier: 0.0, buoyancyAccel: 1.5, restitution: 0.20, isFrozen: false, linearDamping: 0.6, angularDamping: 0.1 },
  YELLOW:  { state: 'YELLOW',  gravityMultiplier: 1.0, buoyancyAccel: 0.0, restitution: 0.88, isFrozen: false, linearDamping: 0.1, angularDamping: 0.2 },
  PURPLE:  { state: 'PURPLE',  gravityMultiplier: 1.0, buoyancyAccel: 0.0, restitution: 0.20, isFrozen: true,  linearDamping: 0.0, angularDamping: 0.0 },
  ORANGE:  { state: 'ORANGE',  gravityMultiplier: 2.0, buoyancyAccel: 0.0, restitution: 0.88, isFrozen: false, linearDamping: 0.1, angularDamping: 0.2 },
  GREEN:   { state: 'GREEN',   gravityMultiplier: 0.0, buoyancyAccel: 1.5, restitution: 0.88, isFrozen: false, linearDamping: 0.3, angularDamping: 0.2 },
  WHITE:   { state: 'WHITE',   gravityMultiplier: 1.0, buoyancyAccel: 0.0, restitution: 0.20, isFrozen: false, linearDamping: 0.0, angularDamping: 0.0 },
};

export function profileOf(state: ColorState): ColorPhysicsProfile {
  return COLOR_PROFILES[state];
}

/** 净垂直加速度（仅用于校验/日志）：a = a_b − m_g·G（正值=向上） */
export function netVerticalAccel(p: ColorPhysicsProfile): number {
  return p.buoyancyAccel - p.gravityMultiplier * PHYS.G;
}

/** 由状态取渲染主色（Toon 材质 tint，GDD §7.5）。此处给归一化 RGB 基准，具体色值在美术阶段调。 */
export function stateToRGB(state: ColorState): Vec3 {
  switch (state) {
    case 'RED':     return new Vec3(1.0, 0.2, 0.2);
    case 'BLUE':    return new Vec3(0.2, 0.4, 1.0);
    case 'YELLOW':  return new Vec3(1.0, 0.9, 0.2);
    case 'PURPLE':  return new Vec3(0.6, 0.3, 0.9);
    case 'ORANGE':  return new Vec3(1.0, 0.55, 0.1);
    case 'GREEN':   return new Vec3(0.3, 0.9, 0.4);
    case 'WHITE':   return new Vec3(0.95, 0.95, 0.95);
    default:        return new Vec3(0.8, 0.8, 0.85); // NEUTRAL
  }
}
