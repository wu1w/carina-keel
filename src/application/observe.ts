import type { RenderResult, RenderView } from "../schema/index.js";
import type { ShotKind } from "../steward/world-model-brief.js";

/**
 * zh: 世界模型观测。候选画面，不是已固化几何。
 * en: World-model observation. A candidate view, not frozen geometry.
 */
export type WorldObservation = {
  media: string;
  provider: "lingbot-legacy";
  legacy: true;
  frozen: false;
  still?: RenderResult["still"];
  clip?: RenderResult["clip"];
  warnings?: string[];
  prompt?: string;
  style?: string;
  camera?: string;
  shotKind?: ShotKind;
};

export function toObservation(result: RenderResult): WorldObservation {
  const observation: WorldObservation = {
    media: result.media,
    provider: "lingbot-legacy",
    legacy: true,
    frozen: false,
  };
  if (result.still !== undefined) {
    observation.still = result.still;
  }
  if (result.clip !== undefined) {
    observation.clip = result.clip;
  }
  if (result.warnings !== undefined && result.warnings.length > 0) {
    observation.warnings = result.warnings;
  }
  return observation;
}

/**
 * zh: 从观测取出可落盘的静帧。短片用末帧。
 * en: Take a still that can be committed. Clips use the last frame.
 */
export function stillBytesFromObservation(
  observation: WorldObservation | undefined,
): { bytes: Uint8Array; mime: string } | undefined {
  if (observation === undefined) {
    return undefined;
  }
  const still = observation.still;
  if (still !== undefined && still.base64.length > 0) {
    return { bytes: decodeBase64(still.base64), mime: still.mime };
  }
  const clip = observation.clip;
  const last = clip?.frames.at(-1);
  if (clip !== undefined && last !== undefined) {
    return { bytes: decodeBase64(last), mime: clip.mime };
  }
  return undefined;
}

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/**
 * zh: 组装交给 sidecar 的视图。画面指令用管家转译的 style/camera，不塞网格名。
 * en: Build the sidecar view. Style/camera come from the steward; no mesh names.
 */
export function observationView(input: {
  worldId: string;
  name: string;
  prompt: string;
  style: string;
  camera?: string;
  fresh: boolean;
}): RenderView {
  const view: RenderView = {
    placeId: input.worldId,
    placeName: sceneTitle(input.name, input.prompt),
    entities: [],
    intent: input.prompt,
    style: input.style,
  };
  if (input.camera !== undefined && input.camera.length > 0) {
    view.camera = input.camera;
  }
  if (input.fresh) {
    view.fresh = true;
  }
  return view;
}

/**
 * zh: 运行中的空闲生命：微风、水面、灯火，不改场景。
 * en: Idle life while running: breeze, water, lanterns; do not change the place.
 */
export const IDLE_MOTION_STYLE =
  "gentle breeze, rippling water, flickering lanterns, cloth and leaves moving slightly, natural idle life, no new objects, no hard camera cut";

/**
 * zh: 运行中的空闲镜头：呼吸感，不切镜。
 * en: Idle camera while running: breathing, no cut.
 */
export const IDLE_CAMERA =
  "eye-level first-person, quiet breathing, tiny head sway, flickering light, rippling water in place";

/**
 * zh: 待机只动镜头/生命，不改场景基线，也不重做种子图。
 * en: Idle only moves camera/life. It does not rewrite the scene baseline or rebake the seed.
 */
export function idleObservationView(input: {
  worldId: string;
  name: string;
  prompt: string;
  baselineStyle: string;
  camera?: string;
}): RenderView {
  const action =
    input.camera !== undefined && input.camera.length > 0
      ? `${input.camera}. ${IDLE_MOTION_STYLE}`
      : `${IDLE_CAMERA}. ${IDLE_MOTION_STYLE}`;
  return observationView({
    worldId: input.worldId,
    name: input.name,
    prompt: input.prompt,
    style: input.baselineStyle,
    camera: action,
    fresh: false,
  });
}

/**
 * zh: 观测写入命令 payload。去掉不能 JSON 化的字段。
 * en: Copy an observation into a command payload. Omit non-JSON fields.
 */
export function observationPayload(
  observation: WorldObservation,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: observation.provider,
    legacy: observation.legacy,
    frozen: observation.frozen,
  };
  if (observation.still !== undefined) {
    payload["still"] = observation.still;
  }
  if (observation.clip !== undefined) {
    payload["clip"] = observation.clip;
  }
  if (observation.warnings !== undefined && observation.warnings.length > 0) {
    payload["warnings"] = observation.warnings;
  }
  if (observation.prompt !== undefined) {
    payload["prompt"] = observation.prompt;
  }
  if (observation.shotKind !== undefined) {
    payload["shotKind"] = observation.shotKind;
  }
  if (observation.camera !== undefined) {
    payload["camera"] = observation.camera;
  }
  return payload;
}

/**
 * zh: 种子图地点名：不要用演示名或 ULID。
 * en: Seed place title: never the demo name or a ULID.
 */
export function sceneTitle(name: string, prompt: string): string {
  if (
    /^carina-demo$/i.test(name) ||
    /^world$/i.test(name) ||
    /^01[0-9A-HJKMNP-TV-Z]{24}$/.test(name)
  ) {
    return prompt.length > 0 ? prompt : name;
  }
  return name;
}
