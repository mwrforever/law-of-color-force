/**
 * ColorForceSystem.ts —— 逐物体重力/浮力施加（Cocos Component，固定步）
 * 对应 color-physics-gdd §7.1。关闭全局重力后，每物理固定步遍历受管刚体 applyForce。
 *
 * 设计：本类作为场景内唯一实例（PaintableBody 据此注册/注销自身）。
 * 也可改为 director.on('physics-step') 订阅，或继承 System；Component.fixedUpdate 已足够。
 */
import { _decorator, Component, Vec3, PhysicsSystem } from 'cc';
import { PHYS, profileOf } from './ColorPhysicsProfile';
import type { PaintableBody } from './PaintableBody';

const { ccclass } = _decorator;

@ccclass('ColorForceSystem')
export class ColorForceSystem extends Component {
  /** 场景内唯一实例（PaintableBody 据此注册自己） */
  static active: ColorForceSystem | null = null;

  private managed = new Set<PaintableBody>();
  // 复用临时向量，避免每步分配（core 热路径零分配）
  private static _force = new Vec3();
  private static _vel = new Vec3();

  onLoad() {
    ColorForceSystem.active = this;
    // 关闭全局重力：逐物体改由 applyForce 实现 per-body 重力/浮力（GDD §7.1）
    // TODO: 校验 Cocos API —— PhysicsSystem.instance.gravity 在 3.x 为 Vec3，set(0,0,0) 即可关闭全局重力
    const g = PhysicsSystem.instance?.gravity;
    if (g) g.set(0, 0, 0);
  }

  onDestroy() {
    if (ColorForceSystem.active === this) ColorForceSystem.active = null;
  }

  register(body: PaintableBody) { this.managed.add(body); }
  unregister(body: PaintableBody) { this.managed.delete(body); }

  /**
   * 固定步（每物理步调用）：对每个受管刚体施加 per-body 重力/浮力，并限速防穿透。
   * 净力：F_y = mass·(a_b − m_g·G)，沿 −Y 为下沉（GDD §7.1 推导）。
   */
  fixedUpdate() {
    const G = PHYS.G;
    const maxS = PHYS.MAX_SPEED;
    const f = ColorForceSystem._force;
    const v = ColorForceSystem._vel;

    for (const body of this.managed) {
      const rb = body.rigidBody;
      if (!rb || body.isFrozen) continue; // 定身体（STATIC）不参与受力

      const p = profileOf(body.currentState);
      const mass = rb.mass;
      const fy = mass * (p.buoyancyAccel - p.gravityMultiplier * G);
      f.set(0, fy, 0);

      // TODO: 校验 Cocos API —— RigidBody.applyForce(force, relativePoint?) 在 3.x 存在；
      //       relativePoint 传 ZERO 表示作用于质心（避免产生意外扭矩）。
      rb.applyForce(f, Vec3.ZERO);

      // 限速防穿透（GDD §8 红线：红 m_g=2.0 高速穿透地面）
      // TODO: 校验 Cocos API —— getLinearVelocity(out)/setLinearVelocity(v) 在 3.x 存在
      rb.getLinearVelocity(v);
      const sp = v.length();
      if (sp > maxS) {
        v.multiplyScalar(maxS / sp);
        rb.setLinearVelocity(v);
      }
    }
  }
}
