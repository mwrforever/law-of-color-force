# 关卡系统设计（Level System GDD）

> 文档阶段：Phase 2 系统设计
> 作者：设计负责人 文策渊（design-strategist）
> 关联：`color-physics-gdd.md`（物体物理）、`spray-interaction-gdd.md`（预算/喷涂）、`multiplayer-gdd.md`（竞技场配置）

---

## 1. 概述与设计支柱

关卡系统分两部分：**单人解谜「调色师之旅」** 的关卡数据与进度，以及 **多人「色彩大乱斗」** 的竞技场配置。两者共用同一套色彩物理，差异仅在目标、预算与胜负责任。

**设计支柱**
1. **目标显式可读**：每个关卡一句话目标，玩家开局即知「要染出什么、送到哪里」。
2. **难度可曲线化**：原色数量、预算紧张度、限时机制逐步引入，避免前期认知过载。
3. **失败可重试**：任何失败都可一键重试，零惩罚。

---

## 2. 单人解谜关卡数据结构

```jsonc
{
  "id": "L1-03",
  "chapter": 1,
  "name": "漂浮的方块",
  "sceneObjects": [
    {
      "id": "box01", "prefab": "Cube",
      "position": [0, 1, 0],
      "baseColor": "NEUTRAL",          // 基底色（橡皮擦终点）
      "tags": ["movable", "paintable"]
    },
    { "id": "goalZone", "prefab": "GoalPad", "position": [5, 3, 0], "tags": ["goal"] }
  ],
  "objectives": [                     // 胜负条件（见 §3）
    { "type": "REACH", "target": "box01", "goal": "goalZone" }
  ],
  "paintBudget": 30,                  // 本关喷涂次数
  "timedDye": null,                   // 限时染色机制（见 §5），无则 null
  "hints": ["试试用蓝色让方块飘起来", "蓝+黄=绿，低重力又弹"],
  "starRules": {                      // 星级评价（见 §6）
    "threeStar": { "maxPaintUsed": 12 },
    "twoStar": { "maxPaintUsed": 20 }
  },
  "failConditions": [ "OBJECT_FELL_IN_PIT" ]
}
```

**字段说明**
- `sceneObjects`：场景对象列表，含 prefab、初始位姿、基底色、标签（决定可染色/可移动/是目标区）。
- `objectives`：一个或多个胜负条件，**全部满足**即过关。
- `paintBudget`：喷涂总次数（见喷涂 GDD §2.3）。
- `timedDye`：可选限时染色（§5）。
- `hints`：分层提示，玩家主动查看，不自动弹出。
- `starRules`：星级阈值（§6）。
- `failConditions`：失败触发（如物体坠坑、限时耗尽）。

---

## 3. 目标 / 胜负条件类型

| type | 含义 | 示例 |
|---|---|---|
| `REACH` | 目标物体进入目标区 | 「让方块漂浮到达高台」 |
| `FREEZE_PASS` | 把危害体定身后玩家通过 | 「用紫定身通过摆锤」 |
| `PAINT_WITHIN` | 在限定内把指定物体染成指定复合色 | 「把闸门染成绿（蓝+黄）」 |
| `COMBO` | 多条件同时成立 | 定身摆锤 + 方块到达 |
| `AVOID` | 指定物体不触碰禁区 | 「别让红球掉进火坑」 |

> 所有条件基于**物体当前 `ColorState` + 位姿**判定，由 `LevelRuntime` 每帧轮询，确定性、可同步。

---

## 4. 关卡进度与难度曲线

- **组织**：章节（Chapter）→ 关卡（Level）。建议 4 章 × 10 关 = 40 关起步。
- **难度递增**：
  - 第 1 章：仅单原色（红/蓝/黄）入门，预算宽松。
  - 第 2 章：引入复合色（紫/橙/绿），需叠加推理。
  - 第 3 章：收紧 `paintBudget` + 引入 `timedDye`。
  - 第 4 章：多目标组合 + 动态危害体。
- **解锁规则**：顺序解锁（通前一关解锁后一关）；**累计星数**解锁后续章节（如 2 章需 1 章 ≥ 15 星），激励重刷星级。

---

## 5. 限时染色机制（专节）

**规则**：特定触发后，玩家须在 `duration` 内把指定物体染成 `requiredColor`，否则判负（可重试）。

```jsonc
"timedDye": {
  "trigger": "ENTER_ZONE:triggerPad01",   // 触发条件
  "target": "gate01",                       // 目标物体
  "requiredColor": "GREEN",                 // 需达成的复合色（蓝+黄）
  "duration": 8.0,                          // 秒
  "onFail": "RETRY"                         // 失败后重试本关
}
```

- **计时**：进入触发区开始倒计时；HUD 显式读秒。
- **达成判定**：目标物体 `ColorState == requiredColor` 即暂停计时并标记成功。
- **失败/重试**：超时未达成 → `failConditions` 触发 → 一键重试（保留星级进度，不惩罚）。
- **设计要点**：限时关必给**足够预算**与**明确提示**，避免「时间紧 + 资源紧」双重压力导致认知过载。

---

## 6. 星级评价

- ⭐⭐⭐：完成且 `paintUsed ≤ threeStar.maxPaintUsed`（资源效率）。
- ⭐⭐：完成且 `paintUsed ≤ twoStar.maxPaintUsed`。
- ⭐：完成（消耗更多预算）。
- 星级仅影响解锁与展示，**不影响通关**，降低挫败。
- 数据存档于本地（单机），多人无关。

---

## 7. 多人竞技场配置结构

```jsonc
{
  "arenaId": "Arena_A",
  "bounds": { "min": [-10,-2,-10], "max": [10,12,10] },  // kill-plane 复位边界
  "spawns": [ [0,1,-8], [0,1,8], [-8,1,0], [8,1,0] ],    // 2-4 出生点
  "crown": { "spawn": [0,1,0], "winHoldSec": 15 },        // 皇冠点 + 累计持有秒
  "race":  { "checkpoints": [[...],[...]], "goal": [...] },// 竞速点（竞速模式用）
  "disruptZones": [ { "pos":[...], "radius":3, "effect":"RANDOM_PUSH" } ],
  "paintBudgetPerPlayer": 20,
  "antiAbuse": { "freezeCap":2.5, "hitIFrame":1.5, "selfDyeCooldown":1.0 }
}
```

- `spawns`：按实际人数取前 N 个，均匀分布于场地。
- `crown` / `race`：二选一启用（模式由房间决定）。
- `disruptZones`：环境干扰区（如随机推力），增加混沌趣味。
- `antiAbuse`：与色彩物理 §6、多人 GDD §3 一致的对滥用防护参数。

---

## 8. 实现指引（供 engineering-lead 落地）

**模块结构**
```
src/game/level/
  LevelData.ts          // 关卡/竞技场 JSON Schema 类型
  LevelRuntime.ts       // 加载、轮询 objectives/failConditions、星级结算
  LevelProgress.ts      // 章节/解锁/星数（本地存档）
  TimedDye.ts           // 限时染色计时与判定
  ArenaConfig.ts        // 竞技场配置类型（多人复用）
```

**关键接口草图（非实现）**
```
class LevelRuntime {
  load(level: LevelData): void;
  update(dt): void;                  // 轮询目标/失败/限时
  evaluateStars(): 1|2|3;
  onWin(): void; onFail(reason): void;
}
class LevelProgress {
  isUnlocked(chapter): boolean;
  recordStars(levelId, stars): void;
}
```

**与 Cocos 组件对应**
- `LevelData` → 由 Cocos 编辑器/JSON 资源加载；场景对象 prefab 在编辑器中布置，运行时按 `sceneObjects` 实例化。
- `LevelRuntime` → 场景根节点的 `Component`，`update` 中轮询。
- `LevelProgress` → 接 `wx.getFileSystemManager` 本地存档（小游戏无 DOM Storage 限制，但建议游戏存档走文件/云）。
- 竞技场配置由 `MatchSession`（多人 GDD）读取，复用 `ArenaConfig` 类型。

> 本 GDD 仅交付设计与接口草图，不含引擎代码。
