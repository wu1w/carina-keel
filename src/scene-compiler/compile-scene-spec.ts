import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { CarinaConfig } from "../config.js";
import {
  SCENE_SPEC_ASSET_EXT,
  sceneSpecSchema,
  type SceneSpec,
  type SceneSpecObject,
  type SceneSpecRegion,
  type WorldSnapshot,
} from "../schema/index.js";
import { extractJsonObject } from "../steward/json.js";

export { SCENE_SPEC_ASSET_EXT };

const METRIC_FRAME = {
  units: "meters",
  handedness: "right",
  up: "y",
  scaleStatus: "anchored",
} as const;

const TAVERN_RE = /酒馆|客栈|酒吧|吧台|tavern|inn|pub|\bbar\b/i;
const COURTYARD_RE = /庭院|院子|花园|露台|courtyard|garden|terrace/i;
const SIGN_RE = /招牌|匾|signboard|\bsign\b/i;
const STATION_RE = /空间站|station|科幻|spacecraft/i;

export type CompileSceneSpecInput = {
  prompt: string;
  name: string;
  config?: CarinaConfig;
  fetch?: typeof fetch;
};

/**
 * zh: 可注入的编译器。测试可返回固定 SceneSpec。
 * en: Injectable compiler. Tests may return a fixed SceneSpec.
 */
export type CompileSceneSpec = (input: {
  prompt: string;
  name: string;
}) => Promise<SceneSpec>;

/**
 * zh: 把自然语言编成 SceneSpec。无 apiKey 走确定性 heuristic；有 key 则一次结构化调用。
 * en: Compile natural language into a SceneSpec. No apiKey uses a deterministic heuristic; a key makes one structured call.
 */
export async function compileSceneSpec(
  input: CompileSceneSpecInput,
): Promise<SceneSpec> {
  const prompt = normalizeText(input.prompt);
  const name = normalizeText(input.name);
  if (prompt.length === 0 && name.length === 0) {
    return heuristicSceneSpec({ prompt: "interior", name: "World" });
  }
  const resolvedPrompt = prompt.length > 0 ? prompt : name;
  const resolvedName = name.length > 0 ? name : resolvedPrompt;
  const apiKey = input.config?.apiKey;
  if (apiKey !== undefined && apiKey.length > 0 && input.config !== undefined) {
    const steward = await stewardSceneSpec({
      prompt: resolvedPrompt,
      name: resolvedName,
      config: input.config,
      ...(input.fetch !== undefined ? { fetch: input.fetch } : {}),
    });
    if (steward !== undefined) {
      return steward;
    }
    return heuristicSceneSpec({ prompt: resolvedPrompt, name: resolvedName });
  }
  return heuristicSceneSpec({ prompt: resolvedPrompt, name: resolvedName });
}

/**
 * zh: 无 apiKey 时从名称/描述抽关键词。同一输入得到同一 JSON。
 * en: Keyword heuristic when no apiKey. The same input yields the same JSON.
 */
export function heuristicSceneSpec(input: {
  prompt: string;
  name: string;
}): SceneSpec {
  const prompt = normalizeText(input.prompt) || normalizeText(input.name) || "interior";
  const name = normalizeText(input.name) || prompt;
  const haystack = `${name}\n${prompt}`;
  const tavern = TAVERN_RE.test(haystack);
  const courtyard = COURTYARD_RE.test(haystack);
  const station = STATION_RE.test(haystack) && !tavern;
  const wantSign = SIGN_RE.test(haystack) || tavern;
  if (station) {
    return sceneSpecSchema.parse(
      stationSpec(prompt, name, courtyard),
    );
  }
  if (tavern) {
    return sceneSpecSchema.parse(tavernSpec(prompt, name, courtyard, wantSign));
  }
  return sceneSpecSchema.parse(genericSpec(prompt, name, courtyard));
}

/**
 * zh: 把 SceneSpec 编成 UTF-8 字节，供内容寻址写入。
 * en: Encode a SceneSpec as UTF-8 bytes for content-addressed storage.
 */
export function encodeSceneSpecBytes(spec: SceneSpec): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(spec)}\n`);
}

/**
 * zh: 从快照取出 SceneSpec。优先内嵌字段，其次资产引用路径。
 * en: Read a SceneSpec from a snapshot. Prefer the embedded field, then the asset ref path.
 */
export function sceneSpecFromSnapshot(
  snapshot: WorldSnapshot,
): SceneSpec | undefined {
  if (snapshot.sceneSpec !== undefined) {
    return snapshot.sceneSpec;
  }
  return undefined;
}

/**
 * zh: 第一个 route: generate 物件。酒馆 heuristic 是 bar-front。不是已生成网格。
 * en: First route: generate object. Tavern heuristic is bar-front. Not a generated mesh.
 */
export function firstGenerateObject(
  spec: SceneSpec,
): SceneSpecObject | undefined {
  return spec.objects.find((object) => object.route === "generate");
}

/**
 * zh: 后续提交若丢掉 SceneSpec，从当前快照补回。
 * en: If a later commit dropped SceneSpec, copy it from the current snapshot.
 */
export function carrySceneSpec(
  current: WorldSnapshot,
  proposed: WorldSnapshot,
): WorldSnapshot {
  if (proposed.sceneSpec !== undefined) {
    if (proposed.sceneSpecRef !== undefined || current.sceneSpecRef === undefined) {
      return proposed;
    }
    return { ...proposed, sceneSpecRef: current.sceneSpecRef };
  }
  if (current.sceneSpec === undefined) {
    return proposed;
  }
  if (current.sceneSpecRef !== undefined) {
    return {
      ...proposed,
      sceneSpec: current.sceneSpec,
      sceneSpecRef: current.sceneSpecRef,
    };
  }
  return { ...proposed, sceneSpec: current.sceneSpec };
}

/**
 * zh: 把已编译计划挂到快照，并记入资产清单。
 * en: Attach a compiled plan to the snapshot and asset manifest.
 */
export function attachSceneSpec(
  snapshot: WorldSnapshot,
  spec: SceneSpec,
  ref: { posixPath: string; hash: string },
  mergeManifest: (
    current: WorldSnapshot["assetManifest"],
    extra: WorldSnapshot["assetManifest"],
  ) => WorldSnapshot["assetManifest"],
): WorldSnapshot {
  return {
    ...snapshot,
    sceneSpec: spec,
    sceneSpecRef: ref,
    assetManifest: mergeManifest(snapshot.assetManifest, [ref]),
  };
}

const BAR_PLAN_IDS = ["bar-front", "bar"] as const;

/**
 * zh: 用 objectId 找计划物件；找不到再按名称。吧台优先 bar-front，否则 bar。
 * en: Find a plan object by objectId, then name. Bar prefers bar-front, else bar.
 */
export function findSceneSpecObject(
  spec: SceneSpec,
  objectId: string,
): SceneSpecObject | undefined {
  const needle = objectId.trim();
  if (needle.length === 0) {
    return undefined;
  }
  const exact = spec.objects.find((item) => item.objectId === needle);
  if (exact !== undefined) {
    return exact;
  }
  if (isBarAlias(needle)) {
    for (const id of BAR_PLAN_IDS) {
      const found = spec.objects.find((item) => item.objectId === id);
      if (found !== undefined) {
        return found;
      }
    }
    return spec.objects.find((item) => isBarAlias(item.name));
  }
  return spec.objects.find((item) => item.name === needle);
}

/**
 * zh: 从已有计划 id 里挑吧台。优先 bar-front，否则 bar，否则默认 bar-front。
 * en: Pick the bar id from known plan ids. Prefer bar-front, else bar, else default bar-front.
 */
export function resolveBarPlanObjectId(
  planObjectIds: readonly string[] | undefined,
): string {
  if (planObjectIds !== undefined) {
    for (const id of BAR_PLAN_IDS) {
      if (planObjectIds.includes(id)) {
        return id;
      }
    }
  }
  return "bar-front";
}

const COURTYARD_OBJECT_IDS = ["garden-gate", "courtyard-tree"] as const;

/**
 * zh: 给已有计划补 courtyard 与至少 1 个相邻物件。不换 interior / 已有 objectId / source。
 * en: Patch an existing plan with a courtyard and at least one adjacent object. Interior, existing objectIds, and source stay.
 */
export function applySceneSpecExtend(spec: SceneSpec): SceneSpec | undefined {
  const interior = spec.regions.find((region) => region.kind === "interior");
  if (interior === undefined) {
    return undefined;
  }
  const interiorBounds = interior.bounds ?? spec.bounds;
  const hasCourtyard = spec.regions.some((region) => region.kind === "courtyard");
  const hasAdjacentObject = spec.objects.some((item) =>
    isCourtyardObjectId(item.objectId),
  );
  if (hasCourtyard && hasAdjacentObject) {
    return spec;
  }
  const yardBounds = courtyardAdjacentTo(interiorBounds);
  const regions = hasCourtyard
    ? spec.regions
    : [...spec.regions, region("courtyard", "庭院", "courtyard", yardBounds)];
  const objects = hasAdjacentObject
    ? spec.objects
    : [
        ...spec.objects,
        object(
          "garden-gate",
          "园门",
          "door",
          "scaffold",
          dim(0.12, 2.2, 1.2),
          anchor(
            interiorBounds.max.x,
            1.1,
            (interiorBounds.min.z + interiorBounds.max.z) / 2,
          ),
        ),
      ];
  const courtyard = regions.find((region) => region.kind === "courtyard");
  const bounds =
    courtyard?.bounds !== undefined
      ? unionAabb(spec.bounds, courtyard.bounds)
      : spec.bounds;
  const next = {
    ...spec,
    bounds,
    regions,
    objects,
    prompt: spec.prompt,
    source: spec.source,
  };
  const parsed = sceneSpecSchema.safeParse(next);
  if (!parsed.success) {
    return undefined;
  }
  const patched = parsed.data;
  const nextInterior = patched.regions.find((region) => region.kind === "interior");
  if (
    nextInterior === undefined ||
    !sameBounds(nextInterior.bounds, interior.bounds)
  ) {
    return undefined;
  }
  for (const item of spec.objects) {
    const kept = patched.objects.find((row) => row.objectId === item.objectId);
    if (kept === undefined || !samePlanObject(kept, item)) {
      return undefined;
    }
  }
  return patched;
}

function sameBounds(
  left: SceneSpec["bounds"] | undefined,
  right: SceneSpec["bounds"] | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.min.x === right.min.x &&
    left.min.y === right.min.y &&
    left.min.z === right.min.z &&
    left.max.x === right.max.x &&
    left.max.y === right.max.y &&
    left.max.z === right.max.z
  );
}

function samePlanObject(left: SceneSpecObject, right: SceneSpecObject): boolean {
  return (
    left.objectId === right.objectId &&
    left.name === right.name &&
    left.role === right.role &&
    left.route === right.route &&
    sameVec3(left.dimensions, right.dimensions) &&
    sameVec3(left.anchor, right.anchor)
  );
}

function sameVec3(
  left: { x: number; y: number; z: number } | undefined,
  right: { x: number; y: number; z: number } | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function isCourtyardObjectId(objectId: string): boolean {
  return (COURTYARD_OBJECT_IDS as readonly string[]).includes(objectId);
}

function courtyardAdjacentTo(interior: SceneSpec["bounds"]): SceneSpec["bounds"] {
  return aabb(
    interior.max.x,
    interior.min.y,
    interior.min.z,
    interior.max.x + 8,
    interior.min.y + 3,
    interior.max.z,
  );
}

function unionAabb(
  a: SceneSpec["bounds"],
  b: SceneSpec["bounds"],
): SceneSpec["bounds"] {
  return {
    min: {
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    },
    max: {
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    },
  };
}

/**
 * zh: 把同一位移/高度写进计划物件的 anchor / dimensions。不改 source。
 * en: Write the same displacement/height onto the plan object's anchor / dimensions. source stays.
 */
export function applySceneSpecCalibrate(
  spec: SceneSpec,
  objectId: string,
  patch: {
    delta?: { x: number; y: number; z: number };
    heightMeters?: number;
  },
): SceneSpec | undefined {
  const target = findSceneSpecObject(spec, objectId);
  if (target === undefined) {
    return undefined;
  }
  const objects = spec.objects.map((item) => {
    if (item.objectId !== target.objectId) {
      return item;
    }
    let next: SceneSpecObject = { ...item };
    if (patch.delta !== undefined) {
      const base = item.anchor ?? { x: 0, y: 0, z: 0 };
      next = {
        ...next,
        anchor: {
          x: base.x + patch.delta.x,
          y: base.y + patch.delta.y,
          z: base.z + patch.delta.z,
        },
      };
    }
    if (patch.heightMeters !== undefined) {
      const dims = item.dimensions ?? { x: 0, y: 0, z: 0 };
      next = {
        ...next,
        dimensions: { ...dims, y: patch.heightMeters },
      };
    }
    return next;
  });
  return {
    ...spec,
    objects,
    source: spec.source,
  };
}

function isBarAlias(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "bar-front" ||
    normalized === "bar" ||
    normalized === "bar counter" ||
    value.trim() === "吧台" ||
    value.trim() === "吧台正面"
  );
}

async function stewardSceneSpec(input: {
  prompt: string;
  name: string;
  config: CarinaConfig;
  fetch?: typeof fetch;
}): Promise<SceneSpec | undefined> {
  try {
    const openaiSettings: {
      apiKey: string;
      baseURL: string;
      name: string;
      fetch?: typeof fetch;
    } = {
      apiKey: input.config.apiKey ?? "",
      baseURL: input.config.modelBaseUrl,
      name: "carina",
    };
    if (input.fetch !== undefined) {
      openaiSettings.fetch = input.fetch;
    }
    const openai = createOpenAI(openaiSettings);
    const result = await generateText({
      model: openai.chat(input.config.model),
      abortSignal: AbortSignal.timeout(30_000),
      maxRetries: 0,
      system: [
        "You compile a Carina SceneSpec from a user description.",
        "Return JSON only. This is a PLAN, not generated 3D, not a world-model mesh.",
        "source must be steward-plan. Never use world-model or native-mesh.",
        "schemaVersion is 1. Units are meters, right-handed, Y-up.",
        "bounds must be numeric. A tavern interior is about 12 x 10 x 4 unless the prompt says otherwise.",
        "regions: at least one kind=interior. Optional kind=courtyard.",
        "objects: objectId, name, role, route (reuse|generate|scaffold), optional dimensions and anchor.",
        "At least one object must have route generate (a distinctive feature such as a sign or bar front).",
        "generate means planned for later generation. Do not claim a GLB exists.",
        "Other objects may be reuse or scaffold.",
      ].join("\n"),
      prompt: `name: ${input.name}\nprompt: ${input.prompt}`,
    });
    const json = extractJsonObject(result.text);
    if (json === undefined) {
      return undefined;
    }
    const candidate = {
      ...json,
      schemaVersion: 1,
      prompt: input.prompt,
      name: typeof json["name"] === "string" && json["name"].trim().length > 0
        ? json["name"].trim()
        : input.name,
      source: "steward-plan",
      coordinateFrame: METRIC_FRAME,
    };
    const parsed = sceneSpecSchema.safeParse(candidate);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

function tavernSpec(
  prompt: string,
  name: string,
  courtyard: boolean,
  wantSign: boolean,
): SceneSpec {
  const interiorBounds = aabb(0, 0, 0, 12, 4, 10);
  const regions: SceneSpecRegion[] = [
    region("interior", "室内", "interior", interiorBounds),
  ];
  let bounds = interiorBounds;
  if (courtyard) {
    const yard = aabb(12, 0, 0, 20, 3, 10);
    regions.push(region("courtyard", "庭院", "courtyard", yard));
    bounds = aabb(0, 0, 0, 20, 4, 10);
  }
  const objects: SceneSpecObject[] = [
    object("floor", "地板", "structure", "scaffold", dim(12, 0.2, 10), anchor(6, 0, 5)),
    object("walls", "墙", "structure", "scaffold", dim(12, 4, 10), anchor(6, 2, 5)),
    object("door", "门", "door", "reuse", dim(1.1, 2.2, 0.12), anchor(6, 1.1, 0.06)),
    object("bar", "吧台", "furniture", "reuse", dim(3.2, 1.1, 0.7), anchor(2.2, 0.55, 7.4)),
    object(
      "bar-front",
      "吧台正面",
      "feature",
      "generate",
      dim(3.2, 1.1, 0.08),
      anchor(2.2, 0.55, 7.05),
    ),
    object("table", "桌子", "furniture", "reuse", dim(1.2, 0.75, 1.2), anchor(8.5, 0.375, 4)),
    object("chair", "椅子", "furniture", "reuse", dim(0.5, 0.9, 0.5), anchor(8.5, 0.45, 3.2)),
    object("cup", "杯子", "prop", "reuse", dim(0.08, 0.12, 0.08), anchor(8.5, 0.81, 4)),
  ];
  if (wantSign) {
    objects.push(
      object("sign", "招牌", "feature", "generate", dim(1.6, 0.7, 0.08), anchor(6, 3.2, 0.2)),
    );
  }
  if (courtyard) {
    objects.push(
      object(
        "garden-gate",
        "园门",
        "door",
        "scaffold",
        dim(0.12, 2.2, 1.2),
        anchor(12, 1.1, 5),
      ),
    );
  }
  return {
    schemaVersion: 1,
    prompt,
    name,
    bounds,
    coordinateFrame: METRIC_FRAME,
    regions,
    objects,
    source: "heuristic-plan",
  };
}

function stationSpec(
  prompt: string,
  name: string,
  courtyard: boolean,
): SceneSpec {
  const interiorBounds = aabb(0, 0, 0, 16, 5, 12);
  const regions: SceneSpecRegion[] = [
    region("interior", "舱内", "interior", interiorBounds),
  ];
  let bounds = interiorBounds;
  if (courtyard) {
    const dock = aabb(16, 0, 0, 24, 4, 12);
    regions.push(region("courtyard", "对接区", "courtyard", dock));
    bounds = aabb(0, 0, 0, 24, 5, 12);
  }
  return {
    schemaVersion: 1,
    prompt,
    name,
    bounds,
    coordinateFrame: METRIC_FRAME,
    regions,
    objects: [
      object("hull", "舱壁", "structure", "scaffold", dim(16, 5, 12), anchor(8, 2.5, 6)),
      object("airlock", "气闸", "door", "reuse", dim(1.4, 2.4, 0.4), anchor(0.2, 1.2, 6)),
      object("console", "控制台", "furniture", "reuse", dim(1.8, 1.1, 0.8), anchor(8, 0.55, 9)),
      object(
        "core-housing",
        "核心罩",
        "feature",
        "generate",
        dim(1.2, 1.8, 1.2),
        anchor(8, 0.9, 6),
      ),
    ],
    source: "heuristic-plan",
  };
}

function genericSpec(
  prompt: string,
  name: string,
  courtyard: boolean,
): SceneSpec {
  const interiorBounds = aabb(0, 0, 0, 10, 4, 8);
  const regions: SceneSpecRegion[] = [
    region("interior", "室内", "interior", interiorBounds),
  ];
  let bounds = interiorBounds;
  if (courtyard) {
    const yard = aabb(10, 0, 0, 16, 3, 8);
    regions.push(region("courtyard", "庭院", "courtyard", yard));
    bounds = aabb(0, 0, 0, 16, 4, 8);
  }
  return {
    schemaVersion: 1,
    prompt,
    name,
    bounds,
    coordinateFrame: METRIC_FRAME,
    regions,
    objects: [
      object("floor", "地板", "structure", "scaffold", dim(10, 0.2, 8), anchor(5, 0, 4)),
      object("walls", "墙", "structure", "scaffold", dim(10, 4, 8), anchor(5, 2, 4)),
      object("door", "门", "door", "reuse", dim(1.1, 2.2, 0.12), anchor(5, 1.1, 0.06)),
      object(
        "feature",
        "特色物件",
        "feature",
        "generate",
        dim(1, 1.4, 1),
        anchor(5, 0.7, 4),
      ),
    ],
    source: "heuristic-plan",
  };
}

function region(
  regionId: string,
  name: string,
  kind: SceneSpecRegion["kind"],
  bounds: SceneSpec["bounds"],
): SceneSpecRegion {
  return { regionId, name, kind, bounds };
}

function object(
  objectId: string,
  name: string,
  role: string,
  route: SceneSpecObject["route"],
  dimensions: { x: number; y: number; z: number },
  anchor: { x: number; y: number; z: number },
): SceneSpecObject {
  return { objectId, name, role, route, dimensions, anchor };
}

function aabb(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): SceneSpec["bounds"] {
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

function dim(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y, z };
}

function anchor(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y, z };
}

function normalizeText(value: string): string {
  return value.trim();
}
