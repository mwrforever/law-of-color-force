# 喷涂交互系统设计（Spray Interaction GDD）

> 文档阶段：Phase 2 系统设计
> 作者：设计负责人 文策渊（design-strategist）
> 关联：`color-physics-gdd.md`（颜色→物理映射）、`level-system-gdd.md`（颜料预算/目标）、`multiplayer-gdd.md`（干扰/同步）

---

## 1. 概述与设计支柱

喷涂交互是玩家与「色彩物理」之间的唯一操作界面，包含三大动作：**喷枪（染色）**、**橡皮擦（还原）**、**自我染色（染自身）**。所有动作最终都调用 `PaintableBody.applyPrimary / popPrimary` 与 `SelfDyeController`，由色彩物理系统落地。

**设计支柱**
1. **所见即所得**：喷到哪里、染上什么色、物理如何变，反馈零延迟且明确。
2. **预算可控**：颜料是关卡资源（单人）与对抗资源（多人），必须有清晰计量。
3. **操作容错**：误喷可擦、越界可感知，绝不因操作产生不可逆后果。

---

## 2. 喷枪（Spray Gun）

**2.1 拾取（射线）**
- 输入：触摸点屏幕坐标 → 经主相机生成世界射线（`Camera.screenPointToRay`）。
- 命中：`PhysicsSystem.raycastClosest(ray, mask)` 取最近可染色刚体；`mask` 仅含 `PaintableLayer`。

**2.2 喷涂半径与覆盖率**
- `sprayRadius = 0.6 m`：以命中点为球心做球形重叠查询（`physicsSystem.querySphere`），半径内所有可染色刚体**均获得该原色**（一次喷涂可染多个物体）。
- `sprayCoverage`：本阶段为「全量入栈」模型（命中即整物体染色），区域渐进覆盖列为后续增强。

**2.3 颜料消耗预算**
- 单人：**每关固定 `paintBudget`**（如 30 次喷涂），在 `LevelData` 配置；耗尽则喷枪失效（UI 置灰 + 提示）。
- 多人：**每玩家独立 `paintBudget`**（如 20），对抗资源；橡皮擦不返还（防刷）。
- 预算为「喷涂次数」而非连续量，计量简单、同步友好。

**2.4 命中 → 写入 → 重算**
1. 射线命中 → 取 `hitPoint` 与 `hitBody`。
2. 球形查询得命中集合 `S`。
3. 对 `S` 中每个 `PaintableBody`：`applyPrimary(activePrimary)`（入栈，见色彩物理 §5）。
4. 扣减 `paintBudget`，触发泼溅粒子 + 音效钩子。
5. 多人：向 host 发 `c2s_spray{targetIds, primary, hitPoint}`，由 host 校验后广播（见多人 GDD）。

---

## 3. 橡皮擦（Eraser）

- **逻辑**：对命中集合 `S` 中每个物体执行 `popPrimary()`（LIFO 弹栈一层）；栈空则回到 `baseColor`（物理完全回退）。
- **基底记录**：`PaintableBody.baseColor` 在关卡加载时固化，橡皮擦到底即还原该基底，不遗留中间态。
- **多人**：橡皮擦通常只作用于自己已喷的物体；若设计为可擦他人染色，需 host 校验「该色由你施加」以防作弊（建议本阶段仅可擦自己喷的层）。
- **预算**：橡皮擦**不消耗** `paintBudget`（还原是权利，不是资源）。

---

## 4. 自我染色（Self-Dye）

- **触发**：玩家点击「自染」键（具体快捷键/手势留待 UI 阶段），对**自身碰撞体**施加当前选中原色。
- **应用**：调用 `SelfDyeController.applyPrimary(activePrimary)`，套用色彩物理 §6 的时限规则（`selfDyeDuration=3s`、`cooldown=1s`、紫 `freezeCap=2.5s`）。
- **多人**：自染属个人状态，随玩家快照同步；对他人的自染不可被第三方擦除。

---

## 5. 判定与反馈

| 情形 | 判定 | 反馈 |
|---|---|---|
| 命中可染色体且预算充足 | 成功 | 泼溅粒子 + `onSpraySuccess()` 音效钩子 |
| 命中但 `paintBudget=0` | 失败（资源） | UI 置灰 + `onSprayEmpty()` 钩子 |
| 射线未命中任何可染色体 | 失败（空喷） | 轻微「扑空」粒子 + `onSprayMiss()` 钩子 |
| 橡皮擦命中带色物体 | 成功 | 褪色粒子 + `onErase()` 钩子 |
| 橡皮擦命中无色素体 | 无操作 | 静默 / 轻提示 |

**音效 / 粒子接口（预留，由 audio-director / 美术填）**
```
interface SprayFXHooks {
  onSpraySuccess(primary, hitPoint): void;  // 泼溅粒子 + 音效
  onSprayEmpty(): void;
  onSprayMiss(): void;
  onErase(hitPoint): void;
}
```
> 本 GDD 只定义钩子与触发条件，具体粒子 Prefab / 音频资源由对应职能补充。

---

## 6. 触摸操作接口草图

> UI 具体布局留待 UI 阶段；此处只定义「输入事件 → 系统响应」契约。

| 输入事件（来自 UI/Input） | 系统响应 |
|---|---|
| `TouchDrag`（拖动喷枪光标） | 实时更新 `aimRay` 预览（高亮命中体 + 半径圈） |
| `TouchTap_OnSprayButton` | 以当前 `aimRay` 执行喷枪（§2） |
| `TouchTap_OnEraserButton` | 执行橡皮擦（§3） |
| `TouchTap_OnSelfDyeButton` | 执行自我染色（§4） |
| `TouchTap_OnColorSwatch(R/B/Y)` | 切换 `activePrimary` |

**输入状态机**
```
[选择原色] --点击色板--> [瞄准] --拖拽--> [预览命中]
[瞄准] --点喷枪--> SpraySuccess/Empty/Miss
[瞄准] --点橡皮--> Erase/None
[瞄准] --点自染--> SelfDye(受冷却约束)
```

---

## 7. 与色彩物理系统的接口边界

- 喷涂交互**不持有任何物理数值**，只负责「选中谁、染什么原色、扣多少预算」；物理语义全部委托 `PaintableBody`/`SelfDyeController`/`ColorResolver`。
- 颜色选择 UI 仅暴露 `R/B/Y` 三原色（复合色由叠加解析产生，玩家不可直接选紫/橙/绿）。
- 预算状态由 `LevelRuntime`（单人）或 `MatchSession`（多人）持有，喷涂交互读取并扣减。

---

## 8. 实现指引（供 engineering-lead 落地）

**模块结构**
```
src/game/spray/
  SprayController.ts     // 射线拾取 + 半径查询 + 扣预算 + 调 PaintableBody
  EraserController.ts    // 调 popPrimary
  SelfDyeController.ts   // （与 color-physics 共用，见其 GDD）
  SprayFXHooks.ts        // 反馈钩子接口（预留音效/粒子）
  InputState.ts          // 瞄准/选中/冷却状态机
```

**关键接口草图（非实现）**
```
class SprayController {
  activePrimary: Primary;          // 当前选中 R/B/Y
  paintBudget: number;             // 来自 LevelRuntime / MatchSession
  spray(): 'success'|'empty'|'miss';
  private queryHitBodies(ray, radius): PaintableBody[];
}
class EraserController {
  erase(): 'success'|'none';
}
```

**与 Cocos 组件对应**
- `SprayController` / `EraserController` → 挂在玩家/相机节点，订阅 `Input` 事件。
- 射线：`PhysicsSystem.instance.raycastClosest`；球形查询：`physicsSystem.querySphere`。
- 反馈钩子接入粒子系统（`ParticleSystem`）与音频（`AudioSource`）；资源路径由美术/音频交付后回填。
- 预算：`LevelRuntime` / `MatchSession` 暴露 `consumePaint(n): boolean`。

> 本 GDD 仅交付设计与接口草图，不含引擎代码。
