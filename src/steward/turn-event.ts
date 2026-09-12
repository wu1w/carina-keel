/**
 * zh: 一轮管家对话里给壳看的事件：文本、look 状态、静帧、短片。
 * en: Events a shell can show during a steward turn: text, look status, still, clip.
 */

/**
 * zh: 管家正吐出的文字增量。
 * en: A steward text delta.
 */
export type TurnTextEvent = {
  type: "text";
  text: string;
};

/**
 * zh: 工具开始执行。look 时页面应进入「正在看」。
 * en: A tool started. look should put the stage into "looking".
 */
export type TurnStatusEvent = {
  type: "status";
  tool: string;
};

/**
 * zh: look 产出的静帧。不是图谱几何。
 * en: A still from look. Not graph geometry.
 */
export type TurnStillEvent = {
  type: "still";
  mime: string;
  base64: string;
  width?: number;
  height?: number;
  placeId?: string;
  placeName?: string;
};

/**
 * zh: look 产出的短片。按帧循环播放。
 * en: A clip from look. Played as looping frames.
 */
export type TurnClipEvent = {
  type: "clip";
  mime: string;
  fps: number;
  frames: string[];
  width?: number;
  height?: number;
  placeId?: string;
  placeName?: string;
};

/**
 * zh: 一轮对话可流式产出的事件。
 * en: Streamable events from one steward turn.
 */
export type TurnEvent =
  | TurnTextEvent
  | TurnStatusEvent
  | TurnStillEvent
  | TurnClipEvent;

/**
 * zh: 从 look 工具结果抽出短片事件。优先于静帧。
 * en: Pull a clip event out of a look tool result. Prefer this over a still.
 */
export function clipEventFromLookOutput(
  output: unknown,
): TurnClipEvent | undefined {
  const data = lookDataOf(output);
  if (data === undefined) {
    return undefined;
  }
  const clip = data.clip;
  if (clip === undefined) {
    return undefined;
  }
  const event: TurnClipEvent = {
    type: "clip",
    mime: clip.mime,
    fps: clip.fps,
    frames: clip.frames,
  };
  if (clip.width !== undefined) {
    event.width = clip.width;
  }
  if (clip.height !== undefined) {
    event.height = clip.height;
  }
  if (data.placeId !== undefined) {
    event.placeId = data.placeId;
  }
  if (data.placeName !== undefined) {
    event.placeName = data.placeName;
  }
  return event;
}

/**
 * zh: 从 look 工具结果抽出静帧事件。
 * en: Pull a still event out of a look tool result.
 */
export function stillEventFromLookOutput(
  output: unknown,
): TurnStillEvent | undefined {
  const data = lookDataOf(output);
  if (data === undefined) {
    return undefined;
  }
  const still = data.still;
  if (
    still === undefined ||
    typeof still.mime !== "string" ||
    typeof still.base64 !== "string"
  ) {
    return undefined;
  }
  const event: TurnStillEvent = {
    type: "still",
    mime: still.mime,
    base64: still.base64,
  };
  if (still.width !== undefined) {
    event.width = still.width;
  }
  if (still.height !== undefined) {
    event.height = still.height;
  }
  if (data.placeId !== undefined) {
    event.placeId = data.placeId;
  }
  if (data.placeName !== undefined) {
    event.placeName = data.placeName;
  }
  return event;
}

/**
 * zh: 把 AI SDK fullStream 的一块收成壳事件。有短片就发 clip，否则静帧。
 * en: Map one AI SDK fullStream part into shell events. Prefer clip over still.
 */
export function eventsFromStreamPart(part: {
  type: string;
  text?: string;
  toolName?: unknown;
  output?: unknown;
}): TurnEvent[] {
  if (part.type === "text-delta" && typeof part.text === "string") {
    if (part.text === "") {
      return [];
    }
    return [{ type: "text", text: part.text }];
  }
  if (part.type === "tool-input-start" && part.toolName === "look") {
    return [{ type: "status", tool: "look" }];
  }
  if (part.type === "tool-result" && part.toolName === "look") {
    const clip = clipEventFromLookOutput(part.output);
    if (clip !== undefined) {
      return [clip];
    }
    const still = stillEventFromLookOutput(part.output);
    return still === undefined ? [] : [still];
  }
  return [];
}

/**
 * zh: 把未知 data 收成 look 载荷。
 * en: Shape unknown data as a look payload.
 */
export function lookDataOf(output: unknown):
  | {
      placeId?: string;
      placeName?: string;
      still?: {
        mime: string;
        base64: string;
        width?: number;
        height?: number;
      };
      clip?: {
        mime: string;
        fps: number;
        frames: string[];
        width?: number;
        height?: number;
      };
    }
  | undefined {
  const data = dataRecordOf(output);
  if (data === undefined) {
    return undefined;
  }
  const placeId =
    typeof data["placeId"] === "string" ? data["placeId"] : undefined;
  const placeName =
    typeof data["placeName"] === "string" && data["placeName"].length > 0
      ? data["placeName"]
      : undefined;
  const still = readStill(data["still"]);
  const clip = readClip(data["clip"]);
  return {
    ...data,
    ...(placeId !== undefined ? { placeId } : {}),
    ...(placeName !== undefined ? { placeName } : {}),
    ...(still !== undefined ? { still } : {}),
    ...(clip !== undefined ? { clip } : {}),
  };
}

/**
 * zh: 从工具结果或裸 data 取出 data 对象。
 * en: Pull the data object from a tool result or a bare data record.
 */
function dataRecordOf(
  output: unknown,
): Record<string, unknown> | undefined {
  if (output === undefined || typeof output !== "object" || output === null) {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  if (Object.hasOwn(record, "data") || Object.hasOwn(record, "summary")) {
    const nested = record["data"];
    if (nested !== undefined && typeof nested === "object" && nested !== null) {
      return nested as Record<string, unknown>;
    }
    return undefined;
  }
  return record;
}

/**
 * zh: 读取合法静帧。
 * en: Read a valid still object.
 */
function readStill(raw: unknown):
  | {
      mime: string;
      base64: string;
      width?: number;
      height?: number;
    }
  | undefined {
  if (raw === undefined || typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const still = raw as {
    mime?: unknown;
    base64?: unknown;
    width?: unknown;
    height?: unknown;
  };
  if (typeof still.mime !== "string" || typeof still.base64 !== "string") {
    return undefined;
  }
  return {
    mime: still.mime,
    base64: still.base64,
    ...(typeof still.width === "number" ? { width: still.width } : {}),
    ...(typeof still.height === "number" ? { height: still.height } : {}),
  };
}

/**
 * zh: 读取合法短片。
 * en: Read a valid clip object.
 */
function readClip(raw: unknown):
  | {
      mime: string;
      fps: number;
      frames: string[];
      width?: number;
      height?: number;
    }
  | undefined {
  if (raw === undefined || typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const clip = raw as {
    mime?: unknown;
    fps?: unknown;
    frames?: unknown;
    width?: unknown;
    height?: unknown;
  };
  if (typeof clip.fps !== "number" || !Number.isFinite(clip.fps) || clip.fps <= 0) {
    return undefined;
  }
  if (!Array.isArray(clip.frames) || clip.frames.length < 2) {
    return undefined;
  }
  const frames: string[] = [];
  for (const frame of clip.frames) {
    if (typeof frame !== "string" || frame.length === 0) {
      return undefined;
    }
    frames.push(frame);
  }
  return {
    mime: typeof clip.mime === "string" ? clip.mime : "image/jpeg",
    fps: clip.fps,
    frames,
    ...(typeof clip.width === "number" ? { width: clip.width } : {}),
    ...(typeof clip.height === "number" ? { height: clip.height } : {}),
  };
}
