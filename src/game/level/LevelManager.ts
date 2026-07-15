/**
 * LevelManager.ts —— 单人解谜关卡运行时（加载 / 胜负判定 / 星级结算）
 * 对应 level-system-gdd §3 / §5 / §6。作为场景根节点的 Component，update 中轮询判定。
 *
 * 设计：关卡在编辑器中按 sceneObjects 布置；本组件扫描场景内 PaintableBody 与命名节点做判定，
 * 不负责实例化 prefab（美术阶段回填；如需运行时实例化可走 resources.load + instantiate，见 TODO）。
 * 胜负/失败以回调钩子暴露给 UI（onWin / onFail）。
 */
import { _decorator, Component, Node, Vec3 } from 'cc';
import { PHYS } from '../color-physics/ColorPhysicsProfile';
import { PaintableBody } from '../color-physics/PaintableBody';
import {
  LevelData, Objective, ReachObjective, FreezePassObjective,
  PaintWithinObjective, ComboObjective, AvoidObjective, TimedDyeDef,
} from './LevelTypes';
import { IPaintBudget, LocalPaintBudget, SprayController } from '../spray/SprayController';

const { ccclass, property } = _decorator;

export interface LevelResult {
  win: boolean;
  stars: 1 | 2 | 3;
  paintUsed: number;
  reason?: string;
}

@ccclass('LevelManager')
export class LevelManager extends Component {
  @property(Node) playerNode: Node | null = null;
  @property({ type: Number }) killY = -10; // 坠坑判定高度

  level: LevelData | null = null;
  budget: IPaintBudget | null = null;
  paintUsed = 0;

  /** 结算回调（UI 阶段绑定） */
  onWin?: (r: LevelResult) => void;
  onFail?: (reason: string) => void;

  private _bodies = new Map<string, PaintableBody>();
  private _nodes = new Map<string, Node>();
  private _won = false;
  private _failed = false;
  private _spray: SprayController | null = null;

  private _timed: TimedDyeDef | null = null;
  private _timedActive = false;
  private _timedSuccess = false;
  private _timedLeft = 0;
  private _triggered = false;

  onLoad() {
    this._indexScene();
  }

  /** 加载关卡：注入预算到 SprayController，初始化限时染色；重试时重复调用 */
  load(level: LevelData, spray?: SprayController) {
    this.level = level;
    this._spray = spray ?? null;
    this.paintUsed = 0;
    this._won = this._failed = false;
    this.budget = new LocalPaintBudget(level.paintBudget);
    if (spray) spray.budget = this.budget;

    this._timed = level.timedDye;
    this._timedActive = false;
    this._timedSuccess = false;
    this._timedLeft = this._timed ? this._timed.duration : 0;
    this._triggered = false;

    this._indexScene();
  }

  update(dt: number) {
    if (!this.level || this._won || this._failed) return;
    this._updateTimedDye(dt);
    if (this._checkWin()) { this._win(); return; }
    if (this._checkFail()) { this._fail('objective_fall'); }
  }

  /** 星级结算（不影响通关，GDD §6） */
  evaluateStars(): 1 | 2 | 3 {
    if (!this.level) return 1;
    const r = this.level.starRules;
    if (this.paintUsed <= r.threeStar.maxPaintUsed) return 3;
    if (this.paintUsed <= r.twoStar.maxPaintUsed) return 2;
    return 1;
  }

  // ---- 内部：场景索引 ----
  private _indexScene() {
    this._bodies.clear();
    this._nodes.clear();
    const bodies = this.node.getComponentsInChildren(PaintableBody);
    for (const b of bodies) {
      this._bodies.set(b.node.name, b); // TODO: 用 prefab 配置的 id 字段更稳；此处用节点名
      this._nodes.set(b.node.name, b.node);
    }
    // 索引所有命名节点（目标区/触发板/禁区等非可染色体）
    const nodes = this.node.getComponentsInChildren(Node);
    for (const n of nodes) this._nodes.set(n.name, n);
  }

  // ---- 内部：限时染色（GDD §5）----
  private _updateTimedDye(dt: number) {
    if (!this._timed) return;
    if (!this._timedActive) {
      const zone = this._nodes.get(this._parseZone(this._timed.trigger));
      if (zone && this.playerNode) {
        if (this._dist(this.playerNode, zone) <= 1.5) { this._timedActive = true; this._triggered = true; }
      }
      if (!this._timedActive) return;
    }
    const target = this._bodies.get(this._timed.target);
    if (target && target.currentState === this._timed.requiredColor) {
      this._timedSuccess = true;
      return;
    }
    this._timedLeft -= dt;
    if (this._timedLeft <= 0 && !this._timedSuccess) {
      this._failed = true;
      this._fail('timed_dye_timeout');
    }
  }
  private _parseZone(trigger: string): string {
    const i = trigger.indexOf(':');
    return i >= 0 ? trigger.slice(i + 1) : trigger;
  }

  // ---- 内部：胜负判定 ----
  private _checkWin(): boolean {
    if (!this.level) return false;
    const objOk = this.level.objectives.every((o) => this._evalObjective(o));
    const timedOk = !this._timed || this._timedSuccess;
    return objOk && timedOk;
  }

  private _evalObjective(o: Objective): boolean {
    switch (o.type) {
      case 'REACH':       return this._evalReach(o);
      case 'FREEZE_PASS': return this._evalFreezePass(o);
      case 'PAINT_WITHIN':return this._evalPaintWithin(o);
      case 'COMBO':       return (o as ComboObjective).objectives.every((s) => this._evalObjective(s));
      case 'AVOID':       return this._evalAvoid(o);
    }
  }

  private _evalReach(o: ReachObjective): boolean {
    const t = this._bodies.get(o.target)?.node;
    const g = this._nodes.get(o.goal);
    if (!t || !g) return false;
    return this._dist(t, g) <= (o.radius ?? 1.0);
  }
  private _evalFreezePass(o: FreezePassObjective): boolean {
    const h = this._bodies.get(o.hazard);
    const z = this._nodes.get(o.passZone);
    if (!h || !z || !this.playerNode) return false;
    const frozen = h.currentState === 'PURPLE';
    const passed = this._dist(this.playerNode, z) <= (o.radius ?? 1.5);
    return frozen && passed;
  }
  private _evalPaintWithin(o: PaintWithinObjective): boolean {
    const t = this._bodies.get(o.target);
    if (!t) return false;
    if (t.currentState !== o.requiredColor) return false;
    if (!o.zone) return true;
    const z = this._nodes.get(o.zone);
    return !!z && this._dist(t.node, z) <= (o.radius ?? 2.0);
  }
  private _evalAvoid(o: AvoidObjective): boolean {
    const t = this._bodies.get(o.target)?.node;
    const z = this._nodes.get(o.forbiddenZone);
    if (!t || !z) return true;
    return this._dist(t, z) > (o.radius ?? 1.0);
  }

  private _checkFail(): boolean {
    if (!this.level) return false;
    for (const f of this.level.failConditions) {
      if (f === 'OBJECT_FELL_IN_PIT' || f === 'OUT_OF_BOUNDS') {
        for (const b of this._bodies.values()) {
          if (b.node.worldPosition.y < this.killY) return true;
        }
      }
      // TIMED_DYE_TIMEOUT 已在 _updateTimedDye 中处理
    }
    return false;
  }

  private _win() {
    this._won = true;
    this.onWin?.({ win: true, stars: this.evaluateStars(), paintUsed: this.paintUsed });
  }
  private _fail(reason: string) {
    if (this._failed) return;
    this._failed = true;
    this.onFail?.(reason);
  }

  /** 计费钩子：SprayController 扣预算后由上层累加（或读取 budget.remaining 反推） */
  notePaintUsed(n = 1) { this.paintUsed += n; }

  // ---- 工具 ----
  private _dist(a: Node, b: Node): number {
    return Vec3.distance(a.worldPosition, b.worldPosition);
  }
}
