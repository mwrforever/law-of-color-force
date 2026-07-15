/**
 * SelfDyeController.ts —— 玩家自我染色（含时限/冷却）
 * 对应 color-physics-gdd §6 + DESIGN-DECISIONS④。
 * 挂在玩家节点，复用同一节点的 PaintableBody.recompute()，叠加时限计时器。
 *
 * 规则：
 *  - 紫自染强制 ≤ freezeCap（2.5s）；其余 3s 持续 + 1s 冷却。
 *  - 到期自动还原中性（防软锁，GDD §6）。
 *  - 冷却期内不可再次自染。
 */
import { _decorator, Component } from 'cc';
import { Primary, PHYS } from './ColorPhysicsProfile';
import { ColorResolver } from './ColorResolver';
import { PaintableBody } from './PaintableBody';

const { ccclass } = _decorator;

export type DyePhase = 'idle' | 'dyeing' | 'cooldown';

@ccclass('SelfDyeController')
export class SelfDyeController extends Component {
  private _body: PaintableBody | null = null;
  private _phase: DyePhase = 'idle';
  private _active: Primary | null = null;
  private _timer = 0;       // 当前阶段剩余时间
  private _cooldown = 0;

  onLoad() {
    this._body = this.getComponent(PaintableBody);
  }

  get phase(): DyePhase { return this._phase; }
  get isFrozen(): boolean { return this._body?.isFrozen ?? false; }
  get remainingCooldown(): number { return this._cooldown; }

  /** 自我染色：受冷却约束；紫强制 ≤ freezeCap（DESIGN-DECISIONS④） */
  applyPrimary(p: Primary): boolean {
    if (this._phase !== 'idle' || !this._body) return false;
    this._body.applyPrimary(p);
    this._active = p;
    const state = ColorResolver.resolve([p]);
    const dur = state === 'PURPLE'
      ? Math.min(PHYS.SELF_DYE_DURATION, PHYS.FREEZE_CAP) // 紫强制 ≤2.5s
      : PHYS.SELF_DYE_DURATION;                            // 其余 3s
    this._timer = dur;
    this._phase = 'dyeing';
    return true;
  }

  update(dt: number) {
    if (this._phase === 'dyeing') {
      this._timer -= dt;
      if (this._timer <= 0 && this._active && this._body) {
        this._body.popPrimary(); // 到期：弹出自身原色，还原中性
        this._active = null;
        this._phase = 'cooldown';
        this._cooldown = PHYS.SELF_DYE_COOLDOWN;
      }
    } else if (this._phase === 'cooldown') {
      this._cooldown -= dt;
      if (this._cooldown <= 0) {
        this._cooldown = 0;
        this._phase = 'idle';
      }
    }
  }
}
