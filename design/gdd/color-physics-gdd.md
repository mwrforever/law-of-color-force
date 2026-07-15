# 色彩物理引擎设计（Color Physics GDD）

> 文档阶段：Phase 2 系统设计 · 核心系统实现
> 作者：设计负责人 文策渊（design-strategist）
> 适用范围：《色力法则》微信小游戏（Cocos Creator 3D 内置 cannon + 状态同步）
> 关联文档：`docs/architecture/technical-solution.md`（已锁定技术决策）

---

## 1. 概述与设计支柱

本 GDD 定义「颜色 → 物理法则」的**唯一权威映射**，是喷涂交互、关卡、多人三份 GDD 的共同底层。所有「物理改造」都收敛到一份 `ColorPhysicsProfile`，由统一的 `ColorResolver` 解析、统一的 `ColorForceSystem` 在物理步内施加。

**设计支柱（必须遵守）**
1. **可读即可信**：玩家只要看到颜色，就能 100% 预测物体行为（无隐藏随机）。
2. **确定性可同步**：同一组输入在任何端得到同一物理状态（状态同步依赖此性质）。
3. **改造可回退**：任何染色都能被橡皮擦按层剥离，绝不产生不可逆的死锁态。

**引擎约束（来自技术方案 ADR-003）**：cannon 无原生 per-body `gravityScale`，故关闭全局重力，改为每物理步对受管刚体 `applyForce` 实现逐体重力 / 浮力；定身用 `body.type` 在 `DYNAMIC ↔ STATIC` 间切换；`restitution` 经碰撞材质设置。

---

## 2. 颜色 → 物理参数映射表（数值建议）

世界基准重力 `G = 9.8 m/s²`（向下）。每个受管刚体持有一份 `ColorPhysicsProfile`，字段含义：
- `gravityMultiplier`（m_g）：逐体重力倍率，净向下加速度 = `m_g × G − buoyancyAccel`。
- `buoyancyAccel`（a_b）：向上浮力加速度（m/s²，向上为正）。
- `restitution`（e）：碰撞弹性系数（0~1）。
- `isFrozen`：是否定身（切 STATIC）。

| 颜色 | 原色集合 | m_g | a_b (m/s²) | restitution | 刚体类型 | 行为说明 |
|---|---|---|---|---|---|---|
| ⚪ 中性（基底） | ∅ | 1.0 | 0 | 0.20 | DYNAMIC | 基准重力，低弹 |
| 🔴 红 | {R} | 2.0 | 0 | 0.20 | DYNAMIC | 高重力（下沉快） |
| 🔵 蓝 | {B} | 0.0 | 1.5 | 0.20 | DYNAMIC | 零重力 + 微浮力（缓升） |
| 🟡 黄 | {Y} | 1.0 | 0 | 0.88 | DYNAMIC | 高弹 |
| 🟣 紫 | {R,B} | — | — | — | **STATIC** | 定身 / 固化 |
| 🟠 橙 | {R,Y} | 2.0 | 0 | 0.88 | DYNAMIC | 高重力 + 高弹 |
| 🟢 绿 | {B,Y} | 0.0 | 1.5 | 0.88 | DYNAMIC | 零重力 + 高弹 |
| ⚪ 白（三原色） | {R,B,Y} | 1.0 | 0 | 0.20 | DYNAMIC | **中和 = 回中性**（见 §4） |

**净垂直加速度示例**：红 = `2.0×9.8 − 0 = 19.6` 向下；蓝 = `0 − 1.5 = −1.5` 向上（缓升）；中性 = `9.8` 向下。

> 数值为**起步建议值**，最终以真机手感微调；`m_g=2.0` 为上限（防穿透，见 §7）。

---

## 3. 复合色解析算法（ColorResolver）

输入：物体当前持有的**原色集合** `S ⊆ {R, B, Y}`。输出：8 种状态之一。

```
resolve(S):
  if |S| == 0:            return NEUTRAL
  if R∈S and B∈S and Y∈S: return WHITE          // 三原色 → 中和（设计决策见 §4）
  if R∈S and B∈S:         return PURPLE         // 定身
  if R∈S and Y∈S:         return ORANGE
  if B∈S and Y∈S:         return GREEN
  if R∈S:                 return RED
  if B∈S:                 return BLUE
  if Y∈S:                 return YELLOW
```

解析结果映射到 §2 的 `ColorPhysicsProfile`。**解析是纯函数、无副作用、全端一致**，保证状态同步确定性。

---

## 4. 三原色同时叠加的处理（需拍板的设计决策）

**推荐决策：三原色同体 = ⚪ 白（White）= 中和重置态**，刚体回到中性物理（`m_g=1.0, a_b=0, e=0.20, DYNAMIC`）。

**理由**：① RGB 光学三原色叠加为白，「白=无色=还原」直觉自洽；② 给玩家一个**非橡皮擦的紧急脱困手段**（误喷三种色即自动净化），降低挫败；③ 避免引入第 7 种复合物理，保持 6+中性+白 的清晰格。④ 对同步无副作用（仍是确定性解析）。

**备选方案（若主理人否决白色中和）**：
- (B) 取主导色：按「最近一次喷涂的原色」作为主导，忽略其余 → 解析退化为单层覆盖模型。
- (C) 视为无效：三原色同体时不改变物理（维持上一有效复合色）→ 需额外记录「上一有效态」，逻辑复杂，不推荐。

> ⚠️ **待拍板**：默认采用 (A) 白色中和。若选 (B)/(C)，§3 解析表与喷涂叠加规则（§5）需相应调整。

---

## 5. 多种颜色覆盖同一物体的优先级与叠加规则

物体维护一个**有序原色栈** `primaryStack: Primary[]`（去重、后喷置顶）。

**核心规则（推荐，需拍板）**：**叠加（additive mask），非覆盖、非权重混合。**
- **喷涂**：把目标原色压入栈；若已存在则移至栈顶（幂等，不加倍）。
- **解析**：取栈内原色集合交给 `resolve(S)`，得到单一状态（全局态，非区域混合）。
- **橡皮擦**：弹出栈顶原色（LIFO 逐层回退）；栈空则回到该物体基底色。

**为何不用「后喷覆盖 / 权重混合」**：
- 后喷覆盖 → 喷涂变成「换色」而非「调色」，复合色（紫/橙/绿）无法稳定构造，破坏核心玩法。
- 权重混合 → 物理参数连续模糊、可读性崩塌、且难做确定性同步（浮点权重漂移）。

> ⚠️ **待拍板**：默认 additive mask + LIFO 橡皮擦。区域化喷涂（顶点色/局部贴图混合）列为**后续增强**，本阶段不实现（见 §6 落地方式）。

---

## 6. 自我染色规则（玩家喷涂自身）

玩家碰撞体（胶囊）同样持有 `ColorPhysicsProfile`，由 `SelfDyeController` 施加，并带**时限**防止卡死与滥用。

| 自染 | 玩家表现 | 关键规则 |
|---|---|---|
| 🔴 红 | 下落更快、跳跃顶点降低（跳跃冲量固定 → 顶点 = `J² / (2·m_g·G)`） | 水平移动仍可控 |
| 🔵 蓝 | 缓升、空中可「游动」（WASD 给水平控制力） | 越过场地顶界触发 kill-plane 复位 |
| 🟡 黄 | 落地高弹、台阶弹跳 | 限制单跳反弹次数防失控 |
| 🟣 紫 | **定身：输入忽略、刚体 STATIC** | 持续 ≤ `freezeCap=2.5s` 后自动还原（单人也不会软锁） |
| 🟠 橙 / 🟢 绿 | 红/蓝 与 黄 的组合 | 同上述时限 |

**通用自染参数（建议，待拍板）**：
- `selfDyeDuration = 3.0s`（到期自动还原为中性）；
- `selfDyeCooldown = 1.0s`（还原后冷却，防连喷锁人）；
- 紫色自染强制 `min(selfDyeDuration, freezeCap=2.5s)`；
- 单人模式允许自染（紫自染用于「锚定自己穿过摆锤」等，但受时限保护）。

---

## 7. 与 Cocos 物理的落地方式

**7.1 逐体重力 / 浮力**
- 关闭全局重力：`physicsWorld.gravity.set(0, 0, 0)`。
- 注册 `ColorForceSystem`，在每物理固定步（`fixedUpdate` / `world.preStep`）遍历受管刚体：
  - 向下力：`F_down = mass × m_g × G`（沿 −Y）；
  - 向上浮力：`F_up = mass × a_b`（沿 +Y）；
  - `body.applyForce(F_down − F_up 的合成, body.position)`。
- 受管刚体集合由 `PaintableBody` 组件注册 / 注销。

**7.2 弹性（restitution）**
- 经碰撞材质：`collider.material.restitution = e`；复合接触用 ContactMaterial 取较大值。
- 高弹（e=0.88）叠加 `linearDamping=0.1 / angularDamping=0.2` 防能量发散。

**7.3 定身（紫）**
- 进入：`body.type = STATIC; body.mass = 0; body.updateMassProperties(); velocity/angularVelocity 清零`；保存 `prevType/prevMass/prevVel`。
- 退出：还原 `prevType/prevMass`，恢复 `prevVel`（或清零由玩法决定）。
- 对原本 KINEMATIC 的运动危害体（摆锤），定身即停其运动轨迹——「用紫定身通过摆锤」的核心。

**7.4 运行时切换要点**
- 所有切换走 `PaintableBody.recompute(profile)` 统一入口，禁止散落直接改 body。
- 切换即时生效；快照（多人）只同步 `primaryStack`，由 `resolve` 在收端复算，省带宽且保证一致。

**7.5 喷涂染色的视觉承载**
- 本阶段：材质主色 `material.color` 直接 tint 为解析色（Toon 材质），叠加泼溅粒子（纯视觉）。
- 后续增强（非本阶段）：顶点色 / 局部贴图承载区域化喷涂；当前全局态模型不需要。

---

## 8. 数值平衡与稳定性红线

| 风险 | 缓解 |
|---|---|
| 红（m_g=2.0）高速穿透地面 | 限 `maxSpeed=22 m/s`；物理 `substeps≥2`、`solverIterations≥10`；小/快刚体开 CCD；地面加厚碰撞层 |
| 高弹（e=0.88）能量发散 | 阻尼 + 限制连续反弹；e 上限 0.9 |
| 蓝漂浮无限漂走 | `linearDamping=0.6`；场地顶/侧界 kill-plane 复位 |
| 紫定身卡死流程 | 定身带 `freezeCap`；玩家自染强制时限；危害体定身不影响胜利判定 |
| 白中和误触 | 仅三原色**同时**才触发，单/双色不受影响 |

**四条设计理论红线（全程监控，发现即标注）**：杜绝主导策略、经济失衡、认知过载、支柱漂移。

---

## 9. 实现指引（供 engineering-lead 落地）

**模块结构**
```
src/game/color-physics/
  ColorPhysicsProfile.ts      // 数据：m_g / a_b / restitution / isFrozen
  ColorResolver.ts            // 纯函数 resolve(Set<Primary>) -> ColorState
  ColorForceSystem.ts         // 固定步施加重力/浮力（Cocos System）
  PaintableBody.ts            // Component：primaryStack / recompute() / 注册到 ForceSystem
  SelfDyeController.ts        // 玩家自染 + 时限/冷却
```

**关键接口草图（非实现，仅签名）**
```
interface ColorPhysicsProfile {
  gravityMultiplier: number;   // m_g
  buoyancyAccel: number;        // a_b，向上为正
  restitution: number;          // e
  isFrozen: boolean;
}
type Primary = 'R' | 'B' | 'Y';
type ColorState = 'NEUTRAL'|'RED'|'BLUE'|'YELLOW'|'PURPLE'|'ORANGE'|'GREEN'|'WHITE';

class PaintableBody extends Component {
  primaryStack: Primary[];
  baseColor: ColorState;            // 橡皮擦到底的基底
  recompute(): void;                // 解析+应用 profile 到 cannon body
  applyPrimary(p: Primary): void;   // 入栈+recompute
  popPrimary(): void;               // 橡皮擦 LIFO+recompute
}
```

**与 Cocos 组件对应**
- `ColorForceSystem` → 继承 `System` 或挂 `director.on('physics-step')`；持有受管 body 列表。
- `PaintableBody` → 挂在每个可染色节点的 `RigidBody`/`Collider` 同节点，监听喷涂事件。
- `SelfDyeController` → 挂在玩家节点，复用 `PaintableBody` 的 `recompute`，叠加时限计时器。

> 注：本 GDD 仅交付设计与接口草图，不含引擎代码；具体 `applyForce` 调用、材质赋值由 engineering-lead 在 Cocos 中落地，并回传真机数值微调建议。
