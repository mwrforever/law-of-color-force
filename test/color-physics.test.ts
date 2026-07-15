/**
 * color-physics.test.ts —— 《色力法则》纯色彩物理逻辑单测（TDD: RED → GREEN → REFACTOR）
 * 仅覆盖纯函数 / 数据层，不触碰任何 Cocos 引擎代码或游戏功能。
 */
import { describe, it, expect } from 'vitest';
import { ColorResolver } from '../src/game/color-physics/ColorResolver';
import {
  PHYS,
  COLOR_PROFILES,
  profileOf,
  netVerticalAccel,
  effectiveDyeDuration,
} from '../src/game/color-physics/ColorPhysicsProfile';

// ===== a. ColorResolver.resolve =====
describe('ColorResolver.resolve', () => {
  it('空集 -> NEUTRAL', () => {
    expect(ColorResolver.resolve([])).toBe('NEUTRAL');
  });

  it('单色 R -> RED', () => {
    expect(ColorResolver.resolve(['R'])).toBe('RED');
  });

  it('单色 B -> BLUE', () => {
    expect(ColorResolver.resolve(['B'])).toBe('BLUE');
  });

  it('单色 Y -> YELLOW', () => {
    expect(ColorResolver.resolve(['Y'])).toBe('YELLOW');
  });

  it('R+B -> PURPLE（定身）', () => {
    expect(ColorResolver.resolve(['R', 'B'])).toBe('PURPLE');
  });

  it('R+Y -> ORANGE', () => {
    expect(ColorResolver.resolve(['R', 'Y'])).toBe('ORANGE');
  });

  it('B+Y -> GREEN', () => {
    expect(ColorResolver.resolve(['B', 'Y'])).toBe('GREEN');
  });

  it('R+B+Y -> WHITE（中和）', () => {
    expect(ColorResolver.resolve(['R', 'B', 'Y'])).toBe('WHITE');
  });

  it('重复原色被忽略：R,R,B -> PURPLE', () => {
    expect(ColorResolver.resolve(['R', 'R', 'B'])).toBe('PURPLE');
  });

  it('顺序无关：B,R -> PURPLE', () => {
    expect(ColorResolver.resolve(['B', 'R'])).toBe('PURPLE');
  });
});

// ===== b. profileOf / COLOR_PROFILES =====
describe('profileOf / COLOR_PROFILES', () => {
  it('profileOf(RED).gravityMultiplier === 2.0', () => {
    expect(profileOf('RED').gravityMultiplier).toBe(2.0);
  });

  it('profileOf(BLUE).buoyancyAccel === 1.5', () => {
    expect(profileOf('BLUE').buoyancyAccel).toBe(1.5);
  });

  it('profileOf(YELLOW).restitution === 0.88', () => {
    expect(profileOf('YELLOW').restitution).toBe(0.88);
  });

  it('profileOf(PURPLE).isFrozen === true', () => {
    expect(profileOf('PURPLE').isFrozen).toBe(true);
  });

  it('profileOf(WHITE).gravityMultiplier === 1.0', () => {
    expect(profileOf('WHITE').gravityMultiplier).toBe(1.0);
  });

  it('profileOf(NEUTRAL).gravityMultiplier === 1.0', () => {
    expect(profileOf('NEUTRAL').gravityMultiplier).toBe(1.0);
  });

  it('COLOR_PROFILES 表含全部 8 态', () => {
    const states = Object.keys(COLOR_PROFILES).sort();
    expect(states).toEqual(
      ['BLUE', 'GREEN', 'NEUTRAL', 'ORANGE', 'PURPLE', 'RED', 'WHITE', 'YELLOW'].sort()
    );
  });
});

// ===== c. netVerticalAccel =====
describe('netVerticalAccel', () => {
  it('RED ≈ -19.6（向下，重）', () => {
    expect(netVerticalAccel(profileOf('RED'))).toBeCloseTo(-19.6, 5);
  });

  it('BLUE ≈ +1.5（向上，浮力）', () => {
    expect(netVerticalAccel(profileOf('BLUE'))).toBeCloseTo(1.5, 5);
  });

  it('YELLOW ≈ -9.8（向下，基准重力）', () => {
    expect(netVerticalAccel(profileOf('YELLOW'))).toBeCloseTo(-9.8, 5);
  });

  it('NEUTRAL ≈ -9.8（向下，基准重力）', () => {
    expect(netVerticalAccel(profileOf('NEUTRAL'))).toBeCloseTo(-9.8, 5);
  });
});

// ===== d. PHYS 常量（锁定值，不可改）=====
describe('PHYS 常量', () => {
  it('FREEZE_CAP === 2.5', () => {
    expect(PHYS.FREEZE_CAP).toBe(2.5);
  });

  it('SELF_DYE_DURATION === 3.0', () => {
    expect(PHYS.SELF_DYE_DURATION).toBe(3.0);
  });

  it('SELF_DYE_COOLDOWN === 1.0', () => {
    expect(PHYS.SELF_DYE_COOLDOWN).toBe(1.0);
  });

  it('CROWN_WIN_HOLD === 15', () => {
    expect(PHYS.CROWN_WIN_HOLD).toBe(15);
  });

  it('PAINT_BUDGET_SOLO === 30', () => {
    expect(PHYS.PAINT_BUDGET_SOLO).toBe(30);
  });

  it('PAINT_BUDGET_MULTI === 20', () => {
    expect(PHYS.PAINT_BUDGET_MULTI).toBe(20);
  });
});

// ===== e. 新纯函数 effectiveDyeDuration（TDD: 先红后绿）=====
describe('effectiveDyeDuration', () => {
  it('紫 PURPLE 封顶 FREEZE_CAP：requested 3.0 -> 2.5', () => {
    expect(effectiveDyeDuration('PURPLE', 3.0)).toBeCloseTo(2.5, 5);
  });

  it('紫 PURPLE 封顶 FREEZE_CAP：requested 5 -> 2.5', () => {
    expect(effectiveDyeDuration('PURPLE', 5)).toBeCloseTo(2.5, 5);
  });

  it('非紫：requested 3.0 -> min(3.0, SELF_DYE_DURATION)=3.0', () => {
    expect(effectiveDyeDuration('RED', 3.0)).toBeCloseTo(3.0, 5);
  });

  it('非紫：requested 10 -> 封顶 SELF_DYE_DURATION=3.0', () => {
    expect(effectiveDyeDuration('BLUE', 10)).toBeCloseTo(3.0, 5);
  });

  it('非紫：requested 1.0 -> 直取 1.0（未触顶）', () => {
    expect(effectiveDyeDuration('YELLOW', 1.0)).toBeCloseTo(1.0, 5);
  });

  it('WHITE 视为非紫：requested 5 -> 封顶 3.0', () => {
    expect(effectiveDyeDuration('WHITE', 5)).toBeCloseTo(3.0, 5);
  });
});
