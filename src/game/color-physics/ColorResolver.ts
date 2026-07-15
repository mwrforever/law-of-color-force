/**
 * ColorResolver.ts —— 复合色解析（纯函数，确定性）
 * 对应 color-physics-gdd §3 / §4 / §5。同一组原色集合在任何端解析结果完全一致（状态同步依赖此性质）。
 *
 * 设计决策①（DESIGN-DECISIONS）：三原色同体 {R,B,Y} → WHITE（白中和重置态）。
 * 设计决策②（DESIGN-DECISIONS）：叠加原色栈模型，本解析只看「集合」而非顺序/权重。
 */
import { Primary, ColorState, profileOf, ColorPhysicsProfile } from './ColorPhysicsProfile';

export class ColorResolver {
  /**
   * 解析原色集合 -> 8 态之一。
   * @param primes 当前持有的原色（可重复，取集合语义）
   */
  static resolve(primes: Iterable<Primary>): ColorState {
    const set = new Set<Primary>(primes);
    if (set.size === 0) return 'NEUTRAL';

    const hasR = set.has('R');
    const hasB = set.has('B');
    const hasY = set.has('Y');

    if (hasR && hasB && hasY) return 'WHITE'; // 三原色同体 → 白中和（紧急脱困手段）
    if (hasR && hasB) return 'PURPLE';        // 定身
    if (hasR && hasY) return 'ORANGE';
    if (hasB && hasY) return 'GREEN';
    if (hasR) return 'RED';
    if (hasB) return 'BLUE';
    if (hasY) return 'YELLOW';
    return 'NEUTRAL'; // 兜底（理论上不可达）
  }

  /** 解析并直接取对应物理档案 */
  static resolveProfile(primes: Iterable<Primary>): ColorPhysicsProfile {
    return profileOf(ColorResolver.resolve(primes));
  }
}
