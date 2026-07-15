/**
 * PaintableBody.ts —— 可染色体组件（物理改造的唯一受管入口）
 * 对应 color-physics-gdd §5 / §7.3 / §7.4。挂在每个可染色节点的 RigidBody/Collider 同节点。
 *
 * 核心规则：
 *  - primaryStack：有序原色栈（去重、后喷置顶，幂等）。
 *  - applyPrimary / popPrimary / setStack 均经 recompute() 统一落到 cannon body。
 *  - recompute() 是「唯一」直接改 body 的入口（GDD §7.4 禁止散落改 body）。
 *  - 定身（紫）切换 STATIC/DYNAMIC，保存 prev 态，退出还原（GDD §7.3）。
 */
import { _decorator, Component, Node, Vec3, RigidBody, Collider, ERigidBodyType } from 'cc';
import { Primary, ColorState, ColorPhysicsProfile, COLOR_PROFILES } from './ColorPhysicsProfile';
import { ColorResolver } from './ColorResolver';
import { ColorForceSystem } from './ColorForceSystem';

const { ccclass, property } = _decorator;

@ccclass('PaintableBody')
export class PaintableBody extends Component {
  /** 全场景可染色体注册表（供 SprayController 做球形覆盖查询，绕开不确定的 querySphere API） */
  static readonly registry = new Set<PaintableBody>();

  /** 基底色（橡皮擦到底的还原态），关卡加载时固化 */
  @property({ type: String })
  baseColor: ColorState = 'NEUTRAL';

  /** 有序原色栈（去重、后喷置顶） */
  primaryStack: Primary[] = [];

  /** 当前解析态（只读缓存，供外部读取/同步用） */
  currentState: ColorState = 'NEUTRAL';

  private _rb: RigidBody | null = null;
  private _col: Collider | null = null;
  private _frozen = false;
  private _savedType: ERigidBodyType | null = null;
  private _savedMass = 0;
  private _savedVel = new Vec3();
  private _matCloned = false;

  onLoad() {
    this._rb = this.getComponent(RigidBody);
    this._col = this.getComponent(Collider);
    PaintableBody.registry.add(this);
    ColorForceSystem.active?.register(this);
    this.primaryStack = [];
    this.recompute(); // 初始态 = 基底色
  }

  onDestroy() {
    PaintableBody.registry.delete(this);
    ColorForceSystem.active?.unregister(this);
  }

  get rigidBody(): RigidBody | null { return this._rb; }
  get collider(): Collider | null { return this._col; }
  get isFrozen(): boolean { return this._frozen; }
  get nodeRef(): Node { return this.node; }

  /** 原色入栈：幂等（已存在则移至栈顶），随后重算并应用 */
  applyPrimary(p: Primary): void {
    const i = this.primaryStack.indexOf(p);
    if (i >= 0) this.primaryStack.splice(i, 1);
    this.primaryStack.push(p);
    this.recompute();
  }

  /** 橡皮擦：LIFO 弹栈一层；空栈则停在基底（不残留中间态，GDD §5） */
  popPrimary(): void {
    if (this.primaryStack.length > 0) this.primaryStack.pop();
    this.recompute();
  }

  /** 同步用：直接以收端复算的栈覆盖（多人客户端），随后重算 */
  setStack(stack: Primary[]): void {
    this.primaryStack = stack.slice();
    this.recompute();
  }

  /** 统一入口：解析栈 -> profile -> 应用到 cannon body（含定身切换） */
  recompute(): void {
    const state = this.primaryStack.length === 0
      ? this.baseColor
      : ColorResolver.resolve(this.primaryStack);
    this.currentState = state;
    this.applyProfile(COLOR_PROFILES[state]);
  }

  private applyProfile(p: ColorPhysicsProfile) {
    const rb = this._rb;
    if (!rb) return;

    if (p.isFrozen) {
      // —— 进入定身：保存 prev 态，切 STATIC / mass=0，清零速度 ——
      if (!this._frozen) {
        this._savedType = rb.type;
        this._savedMass = rb.mass;
        // TODO: 校验 Cocos API —— getLinearVelocity(out) 在 3.x 存在
        rb.getLinearVelocity(this._savedVel);
        // TODO: 校验 Cocos API —— rb.type 设 ERigidBodyType.STATIC 生效（内部 setType）
        rb.type = ERigidBodyType.STATIC;
        rb.mass = 0;
        // TODO: 校验 Cocos API —— updateMassProperties() 在 3.x 存在
        rb.updateMassProperties();
        rb.setLinearVelocity(Vec3.ZERO);
        rb.setAngularVelocity(Vec3.ZERO);
        this._frozen = true;
      }
    } else {
      // —— 退出定身：还原 prev 态与速度 ——
      if (this._frozen) {
        rb.type = this._savedType ?? ERigidBodyType.DYNAMIC;
        rb.mass = this._savedMass;
        rb.updateMassProperties();
        // TODO: 校验 Cocos API —— setLinearVelocity 在 3.x 存在
        rb.setLinearVelocity(this._savedVel);
        this._frozen = false;
        this._savedType = null;
      }
      // 弹性经碰撞材质（GDD §7.2）
      if (this._col) {
        // TODO: 校验 Cocos API —— collider.material 为 PhysicMaterial，restitution 可写；
        //       为避免共享材质污染他体，首次克隆本体的材质（PhysicMaterial.clone()）。
        if (!this._matCloned) {
          const m = (this._col.material as any).clone();
          this._col.material = m;
          this._matCloned = true;
        }
        this._col.material.restitution = p.restitution;
      }
      // 稳定性阻尼（GDD §7.2 高弹 / §8 蓝漂浮）
      rb.linearDamping = p.linearDamping;
      rb.angularDamping = p.angularDamping;
    }
  }
}
