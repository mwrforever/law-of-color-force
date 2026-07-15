# 多人模式设计（Multiplayer GDD）

> 文档阶段：Phase 2 系统设计
> 作者：设计负责人 文策渊（design-strategist）
> 关联：`color-physics-gdd.md`（共用物理）、`spray-interaction-gdd.md`（干扰喷涂）、`level-system-gdd.md`（竞技场配置）

---

## 1. 概述与设计支柱

多人「色彩大乱斗」为 2–4 人派对对抗，核心乐趣是**用颜色物理互相干扰**（把对手染紫定身、染蓝飘走）并争夺胜利。技术底座：微信房间 + 自托管 WebSocket 中继（host 客户端权威 / 轻量中继），状态同步。

**设计支柱**
1. **干扰即乐趣**：喷涂对手/其物体改变物理是核心对抗，必须有爽点且可被反制。
2. **抗作弊优先**：皇冠/竞速有输赢，关键分值必须 host/中继校验。
3. **弱网可玩**：插值 + 预测 + 重连，单点掉线不炸房。

**同步模式（来自 ADR-004，已锁定）**：状态同步；物理引擎用 Cocos 内置 cannon（无需确定性）。中继为团队自托管 Node/Go（非 CloudBase），仅地址不同，客户端协议不变。

---

## 2. 匹配 / 房间

- **匹配入口**：微信 `wx.createGameRoom` / 实时语音房间创建 2–4 人房；获得 `roomId` + openid 令牌。
- **连接中继**：客户端用 `wx.connectSocket` 连自托管 WebSocket，携带 `roomId` + token；中继校验后分配 `playerId`。
- **host 选定**：首个入房者为 host（客户端权威）；host 退出则按入房顺序顺延（中继协调，避免空窗）。
- **语音**：走微信实时语音服务独立通道，不占游戏 WebSocket。
- **人数**: 2–4；不足 2 人自动取消，超过 4 拒绝入房。

---

## 3. 竞技场互干扰机制

**3.1 干扰手段**
- 喷涂**对手物体**：把对手脚下方块染蓝使其跌落、染紫定身其载具。
- 喷涂**对手本身**：直接对对手碰撞体施加原色（紫=定身、蓝=飘走、红=下坠）。
- 自染（§self-dye）用于自身机动（蓝逃、红冲）。

**3.2 平衡与滥用防护**
| 参数 | 值（建议） | 作用 |
|---|---|---|
| `freezeCap` | 2.5s | 紫定身单次最长，防永久锁人 |
| `hitIFrame` | 1.5s | 被喷涂后短无敌，防连喷秒杀 |
| `selfDyeCooldown` | 1.0s | 自染冷却 |
| `paintBudgetPerPlayer` | 20 | 对抗资源有限，不能无限干扰 |
| `disruptZones` | 见竞技场配置 | 环境随机推力增加混沌但可控 |

- 被干扰后玩家有 `hitIFrame` 窗口，期间不可被再次染色（host 校验）。
- 橡皮擦仅可擦**自己喷的层**（防擦别人成果作弊）。

---

## 4. 胜利条件

**4.1 皇冠争夺（默认）**
- 皇冠场上唯一，触碰即成为持有者。`crown.winHoldSec = 15`：累计持有满 15s 者胜。
- 被他人喷涂干扰掉冠（如染紫定身、染蓝飘离）会掉落皇冠。
- **平局/超时**：单局 `roundTime = 120s`；超时按**累计持冠秒数**最多者胜；并列则进入 `suddenDeath`（下一个触冠并持有 3s 者胜）。

**4.2 竞速（可选模式）**
- 沿 `race.checkpoints` 顺序到达 `goal` 者胜；按完成顺序排名。
- 干扰用于拖慢对手（染蓝让其飘偏、染紫定身）。
- **超时**：按已通过 checkpoint 数 + 进度百分比排名；并列按到达最后点的时间。

---

## 5. host 权威状态同步协议

**5.1 消息类型**
```
// 客户端 → 中继/host
c2s_join     { roomId, token, profile }
c2s_leave    {}
c2s_input    { seq, moveDir, look, jump, buttons }   // 输入变化即发
c2s_spray    { targetKind:'object'|'opponent'|'self', targetId, primary, hitPoint }
c2s_ack      { lastSnapshotTick }                     // 插值缓冲确认

// 中继/host → 客户端
s2c_join_ack { youAreHost, roster, arenaId }
s2c_leave    { playerId, newHostId? }
s2c_snapshot { tick, players:[{id,pos,vel,colorMask,state}], objects:[{id,pos,vel,colorMask}], crown:{holder,sec}, timer }
s2c_win      { winnerId, reason }
```

**5.2 快照频率与表现**
- **快照 15–20 Hz**（状态同步，带宽可控）；客户端以 60fps 渲染。
- **插值**：客户端缓冲 100–150ms 快照，对位置/速度做插值，抵消抖动。
- **预测**：本机玩家本地预测移动与自染结果（立即反馈），以 host 快照校正（小误差平滑回拉）。
- **仅同步 `primaryStack`/`colorMask`**：收端用 `ColorResolver` 复算物理，省带宽且保证一致（见色彩物理 §3）。

**5.3 弱网重连**
- 掉线后用 `roomId+token` 重连；中继保留最近快照，`s2c_join_ack` 补发当前全量状态，客户端无感恢复。
- host 掉线：中继指定新 host，全量状态迁移，不打断对局。

**5.4 作弊防护（host/中继校验）**
- **关键分值**：皇冠累计秒、竞速完成由 host 权威计算，`s2c_win` 只由 host 发出。
- **位置钳制**：拒绝瞬时远距位移（速度超阈值视为作弊，回拉）。
- **喷涂校验**：`c2s_spray` 校验目标在射线范围内、且在 `hitIFrame` 外、预算充足。
- **橡皮擦校验**：仅允许擦自己喷的层。
- 排行榜走微信开放数据域（`createOpenDataContext`）独立线程，防本地改分。

---

## 6. 与单人模式在「颜色物理」上的共用与差异

| 维度 | 单人 | 多人 |
|---|---|---|
| `ColorResolver` / `ColorForceSystem` / `ColorPhysicsProfile` | 共用同一套 | 完全相同 |
| `PaintableBody` / `SelfDyeController` | 共用 | 完全相同 |
| 目标 | 关卡 objectives/failConditions | 皇冠/竞速 win 逻辑 |
| 预算 | 每关 `paintBudget` | 每玩家 `paintBudgetPerPlayer` |
| 干扰 | 无（仅环境危害体） | 玩家间互相喷涂改物理 |
| 同步 | 本地确定性即可 | host 权威快照 + 插值/预测 |
| 时限 | 可选 `timedDye` | 回合 `roundTime` + 突然死亡 |

> 结论：色彩物理是**单一共享内核**，多人只是叠加「对抗干扰 + 同步 + 胜负责任」，不另写物理逻辑。

---

## 7. 实现指引（供 engineering-lead 落地）

**模块结构**
```
src/net/
  RoomManager.ts        // 微信房间 + WebSocket 连接/host 选定
  SyncProtocol.ts       // 消息编解码（二进制/JSON 紧凑）
  SnapshotBuffer.ts     // 快照缓冲 + 插值/预测
  MatchSession.ts       // 对局状态机：join/play/win，读 ArenaConfig
src/game/multiplayer/
  DisruptResolver.ts    // host 端喷涂校验 + 应用（调 PaintableBody）
  WinChecker.ts         // 皇冠累计/竞速排名/超时/suddenDeath
  AntiAbuse.ts          // freezeCap/iframe/cooldown/位置钳制
```

**关键接口草图（非实现）**
```
class MatchSession {
  join(roomId, token): void;
  onSnapshot(s: Snapshot): void;     // 缓冲+插值
  sendInput(i: InputCmd): void;
  sendSpray(target, primary): void;
}
class WinChecker {
  update(dt): void;                  // 累计皇冠秒/竞速进度
  decideWinner(): { winnerId, reason } | null;
}
```

**与 Cocos / 微信对应**
- `RoomManager` → `wx.createGameRoom` + `wx.connectSocket`（小游戏无 DOM WebSocket，须用 wx API）。
- `SnapshotBuffer` → 在 `Game` 的 `update` 中做插值渲染，物理步由 host 驱动。
- `WinChecker` / `AntiAbuse` → 跑在 host 端（或中继若升级为服务器权威），结果经 `s2c_win` 下发。
- 排行榜 → `wx.createOpenDataContext` 独立渲染线程。

> 本 GDD 仅交付设计与接口草图，不含引擎代码。中继服务（Node/Go）由 engineering-lead 按本协议实现，host 权威可后续平滑升级为「中继兼服务器权威」校验。
