/**
 * example-levels.ts —— 示例关卡/竞技场数据（演示 LevelTypes schema 用法）
 * 纯数据对象；真实项目可由 Cocos 编辑器导出 JSON 后 resources.load 加载。
 */
import { LevelData, ArenaConfig } from './LevelTypes';

// ===== 示例 1：单原色入门（红），REACH 目标 =====
export const LEVEL_L1_01: LevelData = {
  id: 'L1-01', chapter: 1, name: '让方块沉进坑',
  sceneObjects: [
    { id: 'box01', prefab: 'Cube', position: [0, 5, 0], baseColor: 'NEUTRAL', tags: ['movable', 'paintable'] },
    { id: 'goalZone', prefab: 'GoalPad', position: [0, 0.5, 0], baseColor: 'NEUTRAL', tags: ['goal'] },
  ],
  objectives: [{ type: 'REACH', target: 'box01', goal: 'goalZone', radius: 1.0 }],
  paintBudget: 30,
  timedDye: null,
  hints: ['试着把方块染红，它会沉得更快'],
  starRules: { threeStar: { maxPaintUsed: 8 }, twoStar: { maxPaintUsed: 16 } },
  failConditions: ['OBJECT_FELL_IN_PIT'],
};

// ===== 示例 2：限时染色 + PAINT_WITHIN（蓝+黄=绿），演示 timedDye 字段 =====
export const LEVEL_L3_05: LevelData = {
  id: 'L3-05', chapter: 3, name: '限时染绿闸门',
  sceneObjects: [
    { id: 'gate01', prefab: 'Gate', position: [0, 2, 0], baseColor: 'NEUTRAL', tags: ['paintable'] },
    { id: 'triggerPad01', prefab: 'TriggerPad', position: [3, 0.5, 0], baseColor: 'NEUTRAL', tags: ['trigger'] },
  ],
  objectives: [{ type: 'PAINT_WITHIN', target: 'gate01', requiredColor: 'GREEN', radius: 2.0 }],
  paintBudget: 30,
  timedDye: {
    trigger: 'ENTER_ZONE:triggerPad01',
    target: 'gate01',
    requiredColor: 'GREEN',
    duration: 8.0,
    onFail: 'RETRY',
  },
  hints: ['进入触发板后，限时内把闸门染成绿（先蓝后黄，或先黄后蓝）'],
  starRules: { threeStar: { maxPaintUsed: 10 }, twoStar: { maxPaintUsed: 20 } },
  failConditions: ['TIMED_DYE_TIMEOUT'],
};

// ===== 示例 3（多人）：皇冠竞技场配置，演示 ArenaConfig schema =====
export const ARENA_CROWN_A: ArenaConfig = {
  arenaId: 'Arena_A', mode: 'CROWN',
  bounds: { min: [-10, -2, -10], max: [10, 12, 10] },
  spawns: [[0, 1, -8], [0, 1, 8], [-8, 1, 0], [8, 1, 0]],
  crown: { spawn: [0, 1, 0], winHoldSec: 15 },
  disruptZones: [{ pos: [0, 1, 5], radius: 3, effect: 'RANDOM_PUSH' }],
  paintBudgetPerPlayer: 20,
  antiAbuse: { freezeCap: 2.5, hitIFrame: 1.5, selfDyeCooldown: 1.0 },
};
