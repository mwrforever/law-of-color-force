/**
 * SprayController.ts —— 喷涂交互（喷枪 / 橡皮擦 / 自我染色）
 * 对应 spray-interaction-gdd §2~§6。只负责「选中谁、染什么原色、扣多少预算」，
 * 物理语义全部委托 PaintableBody / SelfDyeController / ColorResolver（GDD §7 边界）。
 *
 * 不持有任何物理数值；触摸输入事件先留接口（bindTouchInput 占位），具体 UI 绑定留待 UI 阶段。
 */
import { _decorator, Component, Node, Vec3, Camera, director, geometry, PhysicsSystem, PhysicsRayResult } from 'cc';
import { Primary, ColorState, PHYS } from '../color-physics/ColorPhysicsProfile';
import { PaintableBody } from '../color-physics/PaintableBody';
import { SelfDyeController } from '../color-physics/SelfDyeController';

const { ccclass, property } = _decorator;

/** 预算权威接口：单人=本地计数；多人=host 校验后回写（此处给本地实现） */
export interface IPaintBudget {
  tryConsume(count?: number): boolean;
  readonly remaining: number;
}

export class LocalPaintBudget implements IPaintBudget {
  constructor(public remaining: number) {}
  tryConsume(count = 1): boolean {
    if (this.remaining < count) return false;
    this.remaining -= count;
    return true;
  }
}

export type SprayResult = 'success' | 'empty' | 'miss';
export type EraseResult = 'success' | 'none';

/** 反馈钩子（预留音效/粒子，由 audio-director / 美术填，GDD §5） */
export interface SprayFXHooks {
  onSpray?: (pos: Vec3, color: ColorState) => void;       // 通用泼溅（任务要求签名）
  onSpraySuccess?: (pos: Vec3, primary: Primary) => void; // 命中成功
  onSprayEmpty?: () => void;                              // 预算耗尽
  onSprayMiss?: () => void;                               // 空喷
  onErase?: (pos: Vec3) => void;                          // 擦除褪色
}

@ccclass('SprayController')
export class SprayController extends Component {
  @property({ type: String }) activePrimary: Primary = 'R'; // 当前选中 R/B/Y（复合色由叠加解析产生）
  @property(Camera) camera: Camera | null = null;
  @property(Node) localPlayer: Node | null = null;          // 自喷时排除自身（世界喷走 selfDye）
  @property sprayRadius = PHYS.SPRAY_RADIUS;                // 0.6m 球形覆盖

  /** 预算权威（单人由 LevelManager 注入 LocalPaintBudget；多人由 Sync 层接管校验） */
  budget: IPaintBudget | null = null;
  /** 反馈钩子（预留音效/粒子） */
  fx: SprayFXHooks = {};

  private _ray = new geometry.Ray();
  private _hit = new Vec3();

  /** 切色（UI 阶段色板触发，GDD §6） */
  setActivePrimary(p: Primary) { this.activePrimary = p; }

  /**
   * 喷枪：射线拾取 + 球形覆盖 + 扣预算 + 调 applyPrimary（GDD §2）
   * @param screenX 屏幕坐标 X（相机屏幕空间，约定由 UI 阶段传入）
   * @param screenY 屏幕坐标 Y
   */
  spray(screenX: number, screenY: number): SprayResult {
    const cam = this.camera ?? this._findCamera();
    if (!cam) { this.fx.onSprayMiss?.(); return 'miss'; }

    cam.screenPointToRay(screenX, screenY, this._ray);
    // TODO: 校验 Cocos API —— PhysicsSystem.instance.raycastClosest(ray, mask?, maxDist?, queryTrigger?) 返回 boolean
    const hit = PhysicsSystem.instance.raycastClosest(this._ray, this._paintMask());
    if (!hit) { this.fx.onSprayMiss?.(); return 'miss'; }

    const result = PhysicsSystem.instance.raycastClosestResult as PhysicsRayResult;
    this._hit.set(result.hitPoint.x, result.hitPoint.y, result.hitPoint.z);

    // 预算校验（单人本地；多人由 host 校验后回写，客户端可仅作预测）
    if (this.budget && !this.budget.tryConsume(1)) {
      this.fx.onSprayEmpty?.();
      return 'empty';
    }

    const targets = this._queryBodiesInSphere(this._hit, this.sprayRadius);
    const primary = this.activePrimary;
    let painted = 0;
    for (const b of targets) {
      if (this.localPlayer && b.node === this.localPlayer) continue; // 自喷走 selfDye
      b.applyPrimary(primary);
      painted++;
    }
    if (painted > 0) {
      this.fx.onSpray?.(this._hit, this._stateOf(primary));
      this.fx.onSpraySuccess?.(this._hit, primary);
      return 'success';
    }
    this.fx.onSprayMiss?.();
    return 'miss';
  }

  /**
   * 橡皮擦：命中集合 LIFO 弹栈一层（不扣预算，GDD §3）
   */
  erase(screenX: number, screenY: number): EraseResult {
    const cam = this.camera ?? this._findCamera();
    if (!cam) return 'none';
    cam.screenPointToRay(screenX, screenY, this._ray);
    const hit = PhysicsSystem.instance.raycastClosest(this._ray, this._paintMask());
    if (!hit) return 'none';
    const result = PhysicsSystem.instance.raycastClosestResult as PhysicsRayResult;
    this._hit.set(result.hitPoint.x, result.hitPoint.y, result.hitPoint.z);

    const targets = this._queryBodiesInSphere(this._hit, this.sprayRadius);
    let did = 0;
    for (const b of targets) {
      if (this.localPlayer && b.node === this.localPlayer) continue;
      const before = b.primaryStack.length;
      b.popPrimary();
      if (b.primaryStack.length < before) did++;
    }
    if (did > 0) { this.fx.onErase?.(this._hit); return 'success'; }
    return 'none';
  }

  /** 自我染色：转交玩家节点的 SelfDyeController（GDD §4） */
  selfDye(p: Primary): boolean {
    const sdc = this.localPlayer?.getComponent(SelfDyeController)
      ?? this.getComponent(SelfDyeController);
    if (!sdc) return false;
    return sdc.applyPrimary(p);
  }

  // ---- 触摸输入接口占位（具体绑定留待 UI 阶段）----
  /** TODO(UI 阶段)：绑定 TouchTap_OnSprayButton / OnEraserButton / OnSelfDyeButton / OnColorSwatch 等事件 */
  bindTouchInput(): void {
    // 留空：由 UI 层把触摸事件映射到 spray()/erase()/selfDye()/setActivePrimary()
  }

  // ---- 内部 ----
  private _stateOf(p: Primary): ColorState {
    return ({ R: 'RED', B: 'BLUE', Y: 'YELLOW' } as Record<Primary, ColorState>)[p];
  }
  private _paintMask(): number {
    // TODO: 与项目中 PaintableLayer 的 layer 位对齐（默认 0xFFFFFFFF 命中所有）
    return 0xffffffff;
  }
  private _findCamera(): Camera | null {
    const scene = director.getScene();
    if (!scene) return null;
    // TODO: 校验 Cocos API —— 取主相机；实际项目可缓存 Main Camera 引用避免每帧查找
    return scene.getComponentInChildren(Camera);
  }
  /** 球形覆盖查询：遍历 PaintableBody 注册表做距离判定（可靠、不依赖不确定的 querySphere API） */
  private _queryBodiesInSphere(center: Vec3, radius: number): PaintableBody[] {
    const r2 = radius * radius;
    const out: PaintableBody[] = [];
    for (const b of PaintableBody.registry) {
      const wp = b.node.worldPosition;
      const dx = wp.x - center.x, dy = wp.y - center.y, dz = wp.z - center.z;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(b);
    }
    return out;
  }
}
