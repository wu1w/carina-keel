import type {
  RegionRevision,
  RuntimeSnapshot,
  SceneObject,
  Vec3,
  WorldRules,
} from "../schema/index.js";
import { isObjectLocked } from "../spatial/locked-objects.js";
import {
  aabbOverlaps,
  pointInAabb,
  uprightAabb,
  xzDistance,
} from "./collision.js";

/** zh: 玩家水平半径（米）。 en: Player horizontal radius in meters. */
const PLAYER_RADIUS = 0.4;
/** zh: 玩家身高（米）。 en: Player height in meters. */
const PLAYER_HEIGHT = 1.7;
/** zh: NPC 水平半径（米）。 en: NPC horizontal radius in meters. */
const NPC_RADIUS = 0.25;
/** zh: NPC 身高（米）。 en: NPC height in meters. */
const NPC_HEIGHT = 1.7;
/** zh: NPC 步行速度（米/秒）。 en: NPC walk speed in meters per second. */
const NPC_SPEED = 0.35;
/** zh: 玩家步行速度（米/秒）。 en: Player walk speed in meters per second. */
const PLAYER_SPEED = 1.4;
/** zh: 交互距离（米，XZ）。 en: Interaction range in meters on XZ. */
const INTERACT_RANGE = 5;
/** zh: 扫描步进（米）。 en: Sweep step in meters. */
const SWEEP_STEP = 0.05;
/** zh: 固定 tick。 en: Fixed tick. */
const TICK = 1 / 20;
const PLAYER_HOLDER = "player";

/**
 * zh: 玩家/创作者动作。暂停时仍可走、开门、拿放已固化物件。
 * en: Player/author action. Pause still allows walking, opening, and pick up / drop of committed objects.
 */
export type PlayerActionKind =
  | "move"
  | "navigate"
  | "stop"
  | "open"
  | "close"
  | "pickup"
  | "drop"
  | "use"
  | "teleport"
  | "cast"
  | "authorPlace";

/**
 * zh: 运行时动作输入。
 * en: Runtime action input.
 */
export type PlayerAction = {
  kind: PlayerActionKind;
  targetId?: string;
  position?: Vec3;
  yaw?: number;
};

/**
 * zh: 创建运行时的输入。
 * en: Input for creating a world runtime.
 */
export type CreateRuntimeInput = {
  worldId: string;
  revision: string;
  regions: RegionRevision[];
  objects: SceneObject[];
  worldRules: WorldRules;
  simTime?: number;
  controlEpoch: number;
};

/**
 * zh: 本机权威世界运行时。无 Three.js，无定时器；由调用方 step。
 * en: Authoritative local world runtime. No Three.js, no timers; the caller steps.
 */
export type WorldRuntime = {
  pause(): { controlEpoch: number; simTime: number };
  run(): { controlEpoch: number };
  step(dtSeconds: number): RuntimeSnapshot;
  executePlayerAction(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  };
  applyWorldRules(rules: WorldRules): void;
  applyCommittedScene(
    regions: RegionRevision[],
    objects: SceneObject[],
    revision: string,
  ): void;
  snapshot(): RuntimeSnapshot;
  getControlEpoch(): number;
  getRunState(): "running" | "paused";
};

/**
 * zh: 创建权威仿真。默认暂停；出生点在室内且不穿墙。
 * en: Create the authoritative sim. Defaults to paused; spawn is indoor and not in walls.
 */
export function createRuntime(input: CreateRuntimeInput): WorldRuntime {
  return new WorldRuntimeImpl(input);
}

/**
 * zh: 可变运行时状态。场景对象为克隆，避免改写调用方数组。
 * en: Mutable runtime state. Scene objects are cloned so caller arrays are not mutated.
 */
class WorldRuntimeImpl implements WorldRuntime {
  private readonly worldId: string;
  private revision: string;
  private regions: RegionRevision[];
  private objects: SceneObject[];
  private worldRules: WorldRules;
  private simTime: number;
  private controlEpoch: number;
  private runState: "running" | "paused" = "paused";
  private readonly player: {
    position: Vec3;
    yaw: number;
    holdingObjectIds: string[];
  };
  private navGoal: Vec3 | undefined;
  private readonly npcGoals = new Map<string, Vec3>();

  constructor(input: CreateRuntimeInput) {
    this.worldId = input.worldId;
    this.revision = input.revision;
    this.regions = structuredClone(input.regions);
    this.objects = structuredClone(input.objects);
    this.worldRules = input.worldRules;
    this.simTime = input.simTime ?? 0;
    this.controlEpoch = input.controlEpoch;
    this.player = {
      position: findSpawn(this.regions, this.objects),
      yaw: 0,
      holdingObjectIds: heldFromObjects(this.objects),
    };
    this.initNpcGoals();
  }

  /**
   * zh: 暂停：增加 controlEpoch，冻结 simTime 与 NPC。
   * en: Pause: increment controlEpoch and freeze simTime and NPCs.
   */
  pause(): { controlEpoch: number; simTime: number } {
    this.runState = "paused";
    this.controlEpoch += 1;
    this.navGoal = undefined;
    return { controlEpoch: this.controlEpoch, simTime: this.simTime };
  }

  /**
   * zh: 恢复推进。不增加 epoch。
   * en: Resume simulation. Does not increment the epoch.
   */
  run(): { controlEpoch: number } {
    this.runState = "running";
    return { controlEpoch: this.controlEpoch };
  }

  /**
   * zh: 推进仿真。暂停时不走时；大 dt 按 1/20 细分。
   * en: Advance simulation. Paused time does not move; large dt is subdivided at 1/20.
   */
  step(dtSeconds: number): RuntimeSnapshot {
    if (this.runState !== "running" || dtSeconds <= 0) {
      return this.snapshot();
    }
    let left = dtSeconds;
    while (left > 1e-12) {
      const dt = left > TICK ? TICK : left;
      this.advance(dt);
      left -= dt;
    }
    return this.snapshot();
  }

  /**
   * zh: 执行动作。暂停拒绝自动导航；走路、开门、拿放已固化物件仍可用。
   * en: Execute an action. Pause rejects auto-navigate; walking, open, and pick up / drop still work.
   */
  executePlayerAction(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    if (action.kind === "authorPlace") {
      return this.authorPlace(action);
    }
    if (action.kind === "stop") {
      this.navGoal = undefined;
      return this.okResult();
    }
    if (action.kind === "teleport") {
      return this.teleport(action);
    }
    if (action.kind === "cast") {
      return this.cast();
    }
    if (this.runState === "paused" && isPausedRejected(action.kind)) {
      return this.fail("paused");
    }
    switch (action.kind) {
      case "move":
        return this.movePlayer(action);
      case "navigate":
        return this.startNavigate(action);
      case "open":
        return this.setDoor(action, true);
      case "close":
        return this.setDoor(action, false);
      case "pickup":
        return this.pickup(action);
      case "drop":
        return this.drop(action);
      case "use":
        return this.use(action);
      default:
        return this.fail("unsupported");
    }
  }

  /**
   * zh: 载入已编译法则。不改时钟、代次或场景。
   * en: Load compiled rules. Does not change clock, epoch, or scene.
   */
  applyWorldRules(rules: WorldRules): void {
    this.worldRules = structuredClone(rules);
  }

  /**
   * zh: 载入已提交场景。不重置时钟与控制代次。
   * en: Load a committed scene. Does not reset the clock or control epoch.
   */
  applyCommittedScene(
    regions: RegionRevision[],
    objects: SceneObject[],
    revision: string,
  ): void {
    this.regions = structuredClone(regions);
    this.objects = structuredClone(objects);
    this.revision = revision;
    this.player.holdingObjectIds = heldFromObjects(this.objects);
    this.npcGoals.clear();
    this.initNpcGoals();
  }

  /**
   * zh: 当前权威快照。
   * en: Current authoritative snapshot.
   */
  snapshot(): RuntimeSnapshot {
    this.syncHeldPositions();
    const objects: RuntimeSnapshot["objects"] = [];
    const npcs: RuntimeSnapshot["npcs"] = [];
    for (const object of this.objects) {
      const row: RuntimeSnapshot["objects"][number] = {
        sceneObjectId: object.sceneObjectId,
        position: { ...object.transform.position },
        rotationY: object.transform.rotation.y,
      };
      if (object.interactionProfile === "door") {
        row.open = object.open === true;
      }
      objects.push(row);
      if (object.mobility === "actor" || object.interactionProfile === "npc") {
        const npc: RuntimeSnapshot["npcs"][number] = {
          sceneObjectId: object.sceneObjectId,
          position: { ...object.transform.position },
          appearance: { kind: "proxy-mesh", sourceLabel: "proxy-mesh" },
        };
        const goal = this.npcGoals.get(object.sceneObjectId);
        if (goal !== undefined) {
          npc.goal = `${goal.x.toFixed(3)},${goal.y.toFixed(3)},${goal.z.toFixed(3)}`;
        }
        npcs.push(npc);
      }
    }
    return {
      worldId: this.worldId,
      revision: this.revision,
      controlEpoch: this.controlEpoch,
      simTime: this.simTime,
      runState: this.runState,
      player: {
        position: { ...this.player.position },
        yaw: this.player.yaw,
        holdingObjectIds: [...this.player.holdingObjectIds],
      },
      objects,
      npcs,
    };
  }

  getControlEpoch(): number {
    return this.controlEpoch;
  }

  getRunState(): "running" | "paused" {
    return this.runState;
  }

  /**
   * zh: 固定步：时钟、导航、NPC。
   * en: Fixed step: clock, navigation, NPCs.
   */
  private advance(dt: number): void {
    this.simTime += dt;
    this.tickPlayerNav(dt);
    this.tickNpcs(dt);
    this.syncHeldPositions();
  }

  /**
   * zh: 玩家沿导航目标走动。
   * en: Walk the player toward the navigation goal.
   */
  private tickPlayerNav(dt: number): void {
    const goal = this.navGoal;
    if (goal === undefined) {
      return;
    }
    const next = walkToward(
      this.player.position,
      goal,
      PLAYER_SPEED * dt,
      PLAYER_RADIUS,
      PLAYER_HEIGHT,
      this.colliders(undefined),
    );
    this.player.position = next;
    if (xzDistance(next, goal) < 0.08) {
      this.navGoal = undefined;
    }
  }

  /**
   * zh: NPC 慢走；撞墙则停在原地。
   * en: NPCs walk slowly and stop on walls.
   */
  private tickNpcs(dt: number): void {
    for (const object of this.objects) {
      if (object.mobility !== "actor" && object.interactionProfile !== "npc") {
        continue;
      }
      const goal = this.npcGoals.get(object.sceneObjectId);
      if (goal === undefined) {
        continue;
      }
      const now = object.transform.position;
      if (xzDistance(now, goal) < 0.08) {
        continue;
      }
      const next = walkToward(
        now,
        goal,
        NPC_SPEED * dt,
        NPC_RADIUS,
        NPC_HEIGHT,
        this.colliders(object.sceneObjectId),
      );
      setObjectPosition(object, next);
    }
  }

  /**
   * zh: 立即移动到目标点，遇碰撞停在最后自由位置。
   * en: Move immediately toward a point; stop at the last free pose on collision.
   */
  private movePlayer(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    if (action.yaw !== undefined) {
      this.player.yaw = action.yaw;
    }
    const target = action.position;
    if (target === undefined) {
      return this.okResult();
    }
    const dest = { x: target.x, y: 0, z: target.z };
    const reached = slideMove(
      this.player.position,
      dest,
      PLAYER_RADIUS,
      PLAYER_HEIGHT,
      this.colliders(undefined),
    );
    this.player.position = reached;
    this.syncHeldPositions();
    if (xzDistance(reached, dest) > 0.12) {
      return this.fail("blocked");
    }
    return this.okResult();
  }

  /**
   * zh: 设置导航目标，由 step 推进。
   * en: Set a navigation goal; step() advances it.
   */
  private startNavigate(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    if (action.position === undefined) {
      return this.fail("missing_target");
    }
    this.navGoal = { x: action.position.x, y: 0, z: action.position.z };
    if (action.yaw !== undefined) {
      this.player.yaw = action.yaw;
    }
    return this.okResult();
  }

  /**
   * zh: 瞬移。有 no_teleport 条款则拒绝且不改布局。
   * en: Teleport. A no_teleport clause rejects and leaves the layout unchanged.
   */
  private teleport(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    if (this.hasClause("no_teleport")) {
      return this.fail("no_teleport");
    }
    if (this.hasClause("no_magic")) {
      return this.fail("no_magic");
    }
    if (this.runState === "paused") {
      return this.fail("paused");
    }
    if (action.position === undefined) {
      return this.fail("missing_target");
    }
    this.player.position = {
      x: action.position.x,
      y: action.position.y,
      z: action.position.z,
    };
    if (action.yaw !== undefined) {
      this.player.yaw = action.yaw;
    }
    this.syncHeldPositions();
    return this.okResult();
  }

  /**
   * zh: 施法。有 no_magic 条款则拒绝。本运行时不实现魔法效果。
   * en: Cast. A no_magic clause rejects. This runtime does not implement magic.
   */
  private cast(): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    if (this.hasClause("no_magic")) {
      return this.fail("no_magic");
    }
    return this.fail("unsupported");
  }

  /**
   * zh: 开关门。打烊后拒绝开门。
   * en: Open or close a door. Opening is rejected after closing hour.
   */
  private setDoor(
    action: PlayerAction,
    open: boolean,
  ): { ok: boolean; reason?: string; snapshot: RuntimeSnapshot } {
    const door = this.findDoor(action.targetId);
    if (door === undefined) {
      return this.fail("not_found");
    }
    if (xzDistance(this.player.position, door.transform.position) > INTERACT_RANGE) {
      return this.fail("too_far");
    }
    if (open && this.doorLocked()) {
      return this.fail("lock_after_hour");
    }
    door.open = open;
    return this.okResult();
  }

  /**
   * zh: 拾取可移动且 interactionProfile=pickup 的物体。
   * en: Pick up a movable object with interactionProfile pickup.
   */
  private pickup(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    if (action.targetId === undefined) {
      return this.fail("missing_target");
    }
    const object = this.objects.find(
      (entry) => entry.sceneObjectId === action.targetId,
    );
    if (object === undefined) {
      return this.fail("not_found");
    }
    if (isObjectLocked(this.worldRules, object)) {
      return this.fail("lock_object");
    }
    if (
      object.mobility !== "movable" ||
      object.interactionProfile !== "pickup"
    ) {
      return this.fail("not_pickup");
    }
    if (this.player.holdingObjectIds.includes(object.sceneObjectId)) {
      return this.drop(action);
    }
    if (xzDistance(this.player.position, object.transform.position) > INTERACT_RANGE) {
      return this.fail("too_far");
    }
    object.heldBy = PLAYER_HOLDER;
    delete object.parentId;
    if (!this.player.holdingObjectIds.includes(object.sceneObjectId)) {
      this.player.holdingObjectIds.push(object.sceneObjectId);
    }
    setObjectPosition(object, { ...this.player.position });
    return this.okResult();
  }

  /**
   * zh: 把持有物放到脚边。
   * en: Drop a held object at the player's feet.
   */
  private drop(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    const targetId =
      action.targetId ??
      this.player.holdingObjectIds[this.player.holdingObjectIds.length - 1];
    if (targetId === undefined) {
      return this.fail("not_holding");
    }
    if (!this.player.holdingObjectIds.includes(targetId)) {
      return this.fail("not_holding");
    }
    const object = this.objects.find((entry) => entry.sceneObjectId === targetId);
    if (object === undefined) {
      return this.fail("not_found");
    }
    this.player.holdingObjectIds = this.player.holdingObjectIds.filter(
      (id) => id !== targetId,
    );
    delete object.heldBy;
    const feet: Vec3 = {
      x: this.player.position.x + Math.sin(this.player.yaw) * 0.7,
      y: 0,
      z: this.player.position.z + Math.cos(this.player.yaw) * 0.7,
    };
    setObjectPosition(object, feet);
    return this.okResult();
  }

  /**
   * zh: 使用：门则开关，杯子则拾取。
   * en: Use: toggle a door or pick up a cup.
   */
  private use(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    if (action.targetId === undefined) {
      return this.fail("missing_target");
    }
    const object = this.objects.find(
      (entry) => entry.sceneObjectId === action.targetId,
    );
    if (object === undefined) {
      return this.fail("not_found");
    }
    if (object.interactionProfile === "door") {
      return this.setDoor(action, object.open !== true);
    }
    if (object.interactionProfile === "pickup") {
      return this.pickup(action);
    }
    return this.fail("unsupported");
  }

  /**
   * zh: 创作者放置，暂停期间可移动桌子等物体。
   * en: Author placement; tables may move while paused.
   */
  private authorPlace(action: PlayerAction): {
    ok: boolean;
    reason?: string;
    snapshot: RuntimeSnapshot;
  } {
    if (action.targetId === undefined || action.position === undefined) {
      return this.fail("missing_target");
    }
    const object = this.objects.find(
      (entry) => entry.sceneObjectId === action.targetId,
    );
    if (object === undefined) {
      return this.fail("not_found");
    }
    if (isObjectLocked(this.worldRules, object)) {
      return this.fail("lock_object");
    }
    setObjectPosition(object, action.position);
    if (action.yaw !== undefined) {
      object.transform = {
        ...object.transform,
        rotation: { ...object.transform.rotation, y: action.yaw },
      };
    }
    return this.okResult();
  }

  /**
   * zh: 当前碰撞盒：静态/可动物体与关闭的门。手持物与拾取物不挡路。
   * en: Current colliders: static/movable objects and closed doors. Held and pickup items do not block.
   */
  private colliders(ignoreId: string | undefined): SceneObject["bounds"][] {
    const held = new Set(this.player.holdingObjectIds);
    const boxes: SceneObject["bounds"][] = [];
    for (const object of this.objects) {
      if (ignoreId !== undefined && object.sceneObjectId === ignoreId) {
        continue;
      }
      if (held.has(object.sceneObjectId)) {
        continue;
      }
      if (object.interactionProfile === "pickup") {
        continue;
      }
      if (object.mobility === "actor" || object.interactionProfile === "npc") {
        continue;
      }
      if (object.interactionProfile === "door" && object.open === true) {
        continue;
      }
      // A single-viewpoint space shell is a visual overlay. Its AABB fills the
      // room and must not be treated as a solid collider.
      if (object.sceneObjectId.endsWith("-space-shell")) {
        continue;
      }
      if (object.mobility === "static" || object.mobility === "movable") {
        boxes.push(object.bounds);
      }
    }
    return boxes;
  }

  /**
   * zh: 持有物跟随玩家。
   * en: Held objects follow the player.
   */
  private syncHeldPositions(): void {
    for (const id of this.player.holdingObjectIds) {
      const object = this.objects.find((entry) => entry.sceneObjectId === id);
      if (object === undefined) {
        continue;
      }
      setObjectPosition(object, heldPose(this.player.position, this.player.yaw));
      object.heldBy = PLAYER_HOLDER;
      object.transform = {
        ...object.transform,
        rotation: { ...object.transform.rotation, y: this.player.yaw },
      };
    }
  }

  /**
   * zh: 为每个 NPC 设一个室内慢走目标。
   * en: Give each NPC a slow indoor walking goal.
   */
  private initNpcGoals(): void {
    for (const object of this.objects) {
      if (object.mobility !== "actor" && object.interactionProfile !== "npc") {
        continue;
      }
      const region =
        this.regions.find((entry) =>
          pointInAabb(object.transform.position, entry.bounds),
        ) ?? this.regions[0];
      const pos = object.transform.position;
      const minZ = region === undefined ? 1.1 : region.bounds.min.z + 1.1;
      const maxZ = region === undefined ? pos.z : region.bounds.max.z - 1.1;
      const goalZ = clamp(pos.z - 3, minZ, maxZ);
      this.npcGoals.set(object.sceneObjectId, {
        x: pos.x,
        y: 0,
        z: goalZ,
      });
    }
  }

  private findDoor(targetId: string | undefined): SceneObject | undefined {
    if (targetId !== undefined) {
      const object = this.objects.find((entry) => entry.sceneObjectId === targetId);
      if (object !== undefined && object.interactionProfile === "door") {
        return object;
      }
      return undefined;
    }
    let best: SceneObject | undefined;
    let bestDist = Infinity;
    for (const object of this.objects) {
      if (object.interactionProfile !== "door") {
        continue;
      }
      const dist = xzDistance(this.player.position, object.transform.position);
      if (dist < bestDist) {
        best = object;
        bestDist = dist;
      }
    }
    return best;
  }

  private hasClause(kind: WorldRules["clauses"][number]["kind"]): boolean {
    return this.worldRules.clauses.some((clause) => clause.kind === kind);
  }

  /**
   * zh: 仿真时刻的小时数达到打烊条款则锁门。
   * en: Lock doors once simulated hour-of-day reaches the lock clause.
   */
  private doorLocked(): boolean {
    const clause = this.worldRules.clauses.find(
      (entry) => entry.kind === "lock_after_hour",
    );
    if (clause === undefined) {
      return false;
    }
    const hour = Number(clause.payload["hour"]);
    if (!Number.isFinite(hour)) {
      return false;
    }
    const hourOfDay = ((this.simTime / 3600) % 24 + 24) % 24;
    return hourOfDay >= hour;
  }

  private okResult(): {
    ok: boolean;
    snapshot: RuntimeSnapshot;
  } {
    return { ok: true, snapshot: this.snapshot() };
  }

  private fail(reason: string): {
    ok: boolean;
    reason: string;
    snapshot: RuntimeSnapshot;
  } {
    return { ok: false, reason, snapshot: this.snapshot() };
  }
}

/**
 * zh: 暂停时拒绝的玩家动作。走路与拿放/开门仍可用。
 * en: Player actions rejected while paused. Walking and pick up / drop / open still work.
 */
function isPausedRejected(kind: PlayerActionKind): boolean {
  return kind === "navigate";
}

/**
 * zh: 沿线段扫描移动，停在最后不碰撞的位置。
 * en: Sweep along a segment and stop at the last non-colliding pose.
 */
function sweepMove(
  from: Vec3,
  to: Vec3,
  radius: number,
  height: number,
  colliders: SceneObject["bounds"][],
): Vec3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-9) {
    return { ...from };
  }
  const steps = Math.max(1, Math.ceil(dist / SWEEP_STEP));
  let current = { x: from.x, y: from.y, z: from.z };
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const next = {
      x: from.x + dx * t,
      y: from.y,
      z: from.z + dz * t,
    };
    if (collides(uprightAabb(next, radius, height), colliders)) {
      return current;
    }
    current = next;
  }
  return current;
}

/**
 * zh: 朝目标走至多 maxDist 米。
 * en: Walk toward a goal by at most maxDist meters.
 */
function walkToward(
  from: Vec3,
  goal: Vec3,
  maxDist: number,
  radius: number,
  height: number,
  colliders: SceneObject["bounds"][],
): Vec3 {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-9) {
    return { ...from };
  }
  const step = maxDist < dist ? maxDist : dist;
  const to = {
    x: from.x + (dx / dist) * step,
    y: from.y,
    z: from.z + (dz / dist) * step,
  };
  return slideMove(from, to, radius, height, colliders);
}

/**
 * zh: 先沿线段扫，再按轴滑墙；仍到不了目标时停在最近自由点。
 * en: Sweep toward the goal, then slide on axes; stop at the closest free pose.
 */
function slideMove(
  from: Vec3,
  to: Vec3,
  radius: number,
  height: number,
  colliders: SceneObject["bounds"][],
): Vec3 {
  const direct = sweepMove(from, to, radius, height, colliders);
  if (xzDistance(direct, to) <= 0.12) {
    return direct;
  }
  const alongX = sweepMove(
    from,
    { x: to.x, y: from.y, z: from.z },
    radius,
    height,
    colliders,
  );
  const xThenZ = sweepMove(
    alongX,
    { x: alongX.x, y: from.y, z: to.z },
    radius,
    height,
    colliders,
  );
  const alongZ = sweepMove(
    from,
    { x: from.x, y: from.y, z: to.z },
    radius,
    height,
    colliders,
  );
  const zThenX = sweepMove(
    alongZ,
    { x: to.x, y: from.y, z: alongZ.z },
    radius,
    height,
    colliders,
  );
  let best = direct;
  let bestDist = xzDistance(direct, to);
  for (const candidate of [xThenZ, zThenX]) {
    const dist = xzDistance(candidate, to);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * zh: 胶囊是否撞到任一碰撞盒。
 * en: Whether a capsule overlaps any collider.
 */
function collides(
  body: ReturnType<typeof uprightAabb>,
  colliders: SceneObject["bounds"][],
): boolean {
  for (const box of colliders) {
    if (aabbOverlaps(body, box)) {
      return true;
    }
  }
  return false;
}

/**
 * zh: 平移物体位置并同步世界 AABB。
 * en: Translate an object and keep its world AABB in sync.
 */
function setObjectPosition(object: SceneObject, position: Vec3): void {
  const dx = position.x - object.transform.position.x;
  const dy = position.y - object.transform.position.y;
  const dz = position.z - object.transform.position.z;
  object.transform = {
    ...object.transform,
    position: { x: position.x, y: position.y, z: position.z },
  };
  object.bounds = {
    min: {
      x: object.bounds.min.x + dx,
      y: object.bounds.min.y + dy,
      z: object.bounds.min.z + dz,
    },
    max: {
      x: object.bounds.max.x + dx,
      y: object.bounds.max.y + dy,
      z: object.bounds.max.z + dz,
    },
  };
}

/**
 * zh: 在室内找一个不穿墙的出生点。
 * en: Find an indoor spawn that does not intersect walls.
 */
function findSpawn(regions: RegionRevision[], objects: SceneObject[]): Vec3 {
  const interior = regions[0];
  const fallback: Vec3 = { x: 4, y: 0, z: 2 };
  if (interior === undefined) {
    return fallback;
  }
  const b = interior.bounds;
  const candidates: Vec3[] = [
    { x: (b.min.x + b.max.x) / 2, y: 0, z: b.min.z + 2 },
    { x: (b.min.x + b.max.x) / 2, y: 0, z: (b.min.z + b.max.z) / 2 },
    { x: (b.min.x + b.max.x) / 2 + 0.5, y: 0, z: b.min.z + 1.6 },
    { x: (b.min.x + b.max.x) / 2 - 0.5, y: 0, z: b.min.z + 1.6 },
    fallback,
  ];
  const walls = objects
    .filter(
      (object) =>
        object.mobility === "static" && object.interactionProfile !== "door",
    )
    .map((object) => object.bounds);
  for (const pos of candidates) {
    if (!collides(uprightAabb(pos, PLAYER_RADIUS, PLAYER_HEIGHT), walls)) {
      return pos;
    }
  }
  return fallback;
}

/**
 * zh: 手持物在玩家右前方。
 * en: Held items sit forward-right of the player.
 */
function heldPose(position: Vec3, yaw: number): Vec3 {
  return {
    x: position.x + Math.sin(yaw) * 0.42 + Math.cos(yaw) * 0.2,
    y: 1.05,
    z: position.z + Math.cos(yaw) * 0.42,
  };
}

/**
 * zh: 从已提交物体恢复手持列表。
 * en: Restore the held list from committed objects.
 */
function heldFromObjects(objects: SceneObject[]): string[] {
  return objects
    .filter((object) => object.heldBy === PLAYER_HOLDER)
    .map((object) => object.sceneObjectId);
}

/**
 * zh: 将数值限制在闭区间。
 * en: Clamp a number to a closed interval.
 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
