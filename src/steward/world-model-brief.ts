import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { CarinaConfig, CarinaLang } from "../config.js";
import { t } from "../i18n/index.js";
import { extractJsonObject } from "./json.js";

/**
 * zh: 人对世界模型的两类操作：调镜头 / 改场景。
 * en: Two ways humans drive the world model: camera vs scene.
 */
export type ShotKind = "camera" | "scene";

/**
 * zh: 交给世界模型的一镜，以及管家对用户说的那句。
 * en: One shot for the world model, plus the steward's spoken line.
 */
export type WorldModelBrief = {
  shotKind: ShotKind;
  prompt: string;
  style: string;
  camera: string;
  fresh: boolean;
  reply: string;
};

/**
 * zh: 上一镜，镜头指令要沿用场景。
 * en: Last shot, so camera commands can keep the place.
 */
export type LastWorldModelShot = {
  prompt?: string;
  style?: string;
  camera?: string;
  shotKind?: ShotKind;
};

const CAMERA_RE =
  /看向|望向|转向|转头|往左|往右|往上|往下|抬头|低头|靠近|拉近|拉远|后退|镜头|视角|看那个|看这[个盏扇]|走近点|dolly|look at|turn left|turn right|zoom|pan |tilt |closer|back up|look up|look down/;
const SCENE_RE =
  /生成|做一间|做个|来一间|换成|改成|下雨|下雪|天色|把灯|更暗|更亮|场景|夜色|氛围|lighting|atmosphere|fireplace|crowded/;
const PLACE_RE =
  /酒馆|湖边|夕阳|黄昏|空间站|花园|房间|森林|街道|客栈|码头|tavern|station/;
const FRAME_ELEMENT_RE = /吧台|门|窗|灯笼|灯|炉火|炉|桌|椅|人|船|杯|bar|door|window|lantern/;
const VIEW_PREFIX =
  /^(?:看一眼|看一看|看一下|看看|look(?:\s+at)?|生成|做一间|做个|来一间|来一个|出一张|帮我看|走进|走到|新建一个|新开一个|创建一个|新建|把镜头|把视角)\s*/i;
const CAMERA_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/往左|向左|左转|turn left/i, "slowly pan left, eye-level first-person"],
  [/往右|向右|右转|turn right/i, "slowly pan right, eye-level first-person"],
  [/抬头|往上看|look up/i, "tilt the camera up, first-person"],
  [/低头|往下看|look down/i, "tilt the camera down, first-person"],
  [/靠近|拉近|走近|zoom in|closer/i, "dolly in closer to the subject, first-person"],
  [/拉远|后退|zoom out|back up/i, "dolly back, keep first-person eye-level"],
  [/看向吧台|看吧台|look at the bar/i, "turn to face the oak bar, keep first-person"],
  [/看向门|看那扇门|看门|look at the door/i, "turn to face the door, keep first-person"],
  [/看向窗|看窗外|看湖|look (?:at|through) the window/i, "turn toward the window and the view outside"],
];

/**
 * zh: 这句话是不是在对镜头或场景说话。
 * en: Whether the line is a camera or scene request.
 */
export function isViewUtterance(text: string): boolean {
  const normalized = text.replace(/[。！!？?]/g, "").trim();
  if (normalized.length === 0) {
    return false;
  }
  if (
    /^(暂停世界|暂停时间|把世界停下来|继续运行|继续|恢复运行|前进一步|暂停生成|停止生成|pause|resume|run|step)$/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (
    /^(在门外生成花园|门外生成花园|扩展花园|把花园接上|走进花园|开门走进去|走到门口|走到门|走到吧台|走到窗)/.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/^(?:全局记住|全局规则|世界规则|以后这个世界)/.test(normalized)) {
    return false;
  }
  if (/^(?:新建一个|新开一个|创建一个)/.test(normalized)) {
    return false;
  }
  if (
    /[吗]$/.test(normalized) ||
    /^(为什么|什么是|有没有|怎么|how |why |what )/i.test(normalized)
  ) {
    return false;
  }
  return (
    CAMERA_RE.test(normalized) ||
    SCENE_RE.test(normalized) ||
    PLACE_RE.test(normalized) ||
    /^(看一眼|看一看|看一下|看看|look)/i.test(normalized)
  );
}

/**
 * zh: 先分镜头还是改场景。画面里的东西 + 镜头词 → 镜头；地点/天气/光线 → 场景。
 * en: Camera vs scene. Frame elements + camera verbs → camera; place/weather/light → scene.
 */
export function classifyShot(text: string): ShotKind {
  const normalized = text.replace(/[。！!？?]/g, "").trim();
  const camera = CAMERA_RE.test(normalized);
  const scene = SCENE_RE.test(normalized) || PLACE_RE.test(normalized);
  if (camera && !scene) {
    return "camera";
  }
  if (camera && FRAME_ELEMENT_RE.test(normalized) && !PLACE_RE.test(normalized) && !SCENE_RE.test(normalized)) {
    return "camera";
  }
  if (scene) {
    return "scene";
  }
  if (/^(看一眼|看一看|看一下|看看|look(\s+around)?)$/i.test(normalized)) {
    return "camera";
  }
  if (camera) {
    return "camera";
  }
  return "scene";
}

/**
 * zh: 去掉「看一眼」这类动词，留下要看的东西。
 * en: Strip look/create verbs; keep the thing they want to see.
 */
export function scenePrompt(text: string, worldName: string): string {
  let value = text.trim().replace(VIEW_PREFIX, "").replace(/[。！!？?]/g, "").trim();
  value = value.replace(/^世界[，,]\s*/, "").trim();
  if (value.length === 0 || /^(看一眼|看看|look)$/i.test(value)) {
    return worldName;
  }
  return value;
}

/**
 * zh: 无模型时的镜头英文。
 * en: Camera English when no LLM is available.
 */
export function heuristicCamera(text: string): string {
  for (const [pattern, line] of CAMERA_HINTS) {
    if (pattern.test(text)) {
      return line;
    }
  }
  return "eye-level first-person, hold still, no head sway";
}

/**
 * zh: 无模型时的场景英文。不把网格名写进去。
 * en: Scene English when no LLM is available. No mesh names.
 */
export function heuristicStyle(prompt: string, worldName: string): string {
  const source = `${prompt} ${worldName}`;
  const tavern = /酒馆|客栈|tavern|inn|pub/i.test(source);
  const lake = /湖|lake/i.test(source);
  const dusk = /夕阳|黄昏|dusk|sunset/i.test(source);
  const rain = /雨|rain/i.test(source);
  const night = /夜|night/i.test(source);
  const station = /空间站|station/i.test(source);
  const garden = /花园|garden/i.test(source);
  if (tavern && lake) {
    const light = dusk
      ? "at dusk, warm lanterns and a fireplace, sunset on the lake"
      : rain
        ? "in the rain, wet windows, warm lanterns"
        : "warm lanterns and a fireplace";
    return `first-person view inside a wooden lakeside tavern ${light}, oak bar and tables, lake and mountains visible through the windows`;
  }
  if (tavern) {
    return dusk
      ? "first-person view inside a wooden tavern at dusk, warm lanterns, oak bar, people at tables"
      : "first-person view inside a wooden tavern, warm lanterns, oak bar, people at tables";
  }
  if (station) {
    return "first-person view inside a space station corridor, cool lights, metal bulkheads, windows onto stars";
  }
  if (garden) {
    return "first-person view in a garden, plants close to camera, natural daylight";
  }
  if (night) {
    return `first-person night view of ${prompt || worldName}, dim practical lights`;
  }
  const title = prompt.trim().length > 0 ? prompt.trim() : worldName;
  return `first-person view of ${title}, photorealistic, natural lighting`;
}

/**
 * zh: 按镜头/场景拼一句人话。
 * en: Spoken line for camera vs scene.
 */
export function formatViewReply(
  lang: CarinaLang,
  shotKind: ShotKind,
  brief: string,
): string {
  const key =
    shotKind === "camera"
      ? "ui.observationReadyCamera"
      : "ui.observationReadyScene";
  return t(key, lang).replace("{brief}", brief);
}

/**
 * zh: 无管家模型时的兜底转译。
 * en: Fallback translation when the steward model is unavailable.
 */
export function heuristicWorldModelBrief(input: {
  text: string;
  worldName: string;
  lang: CarinaLang;
  last?: LastWorldModelShot;
}): WorldModelBrief {
  const shotKind = classifyShot(input.text);
  const prompt = scenePrompt(input.text, input.worldName);
  const camera = heuristicCamera(input.text);
  const lastStyle = input.last?.style;
  const style =
    shotKind === "camera" && lastStyle !== undefined && lastStyle.length > 0
      ? `${lastStyle}. Same place; only the camera moves: ${camera}`
      : heuristicStyle(prompt, input.worldName);
  return {
    shotKind,
    prompt,
    style,
    camera,
    fresh: shotKind === "scene",
    reply: formatViewReply(input.lang, shotKind, prompt),
  };
}

/**
 * zh: 管家把用户原话转成世界模型指令。失败返回 undefined。
 * en: Steward translates the user's line into a world-model instruction. Failure returns undefined.
 */
export async function translateWorldModelInstruction(input: {
  text: string;
  worldName: string;
  config: CarinaConfig;
  worldContext?: string;
  last?: LastWorldModelShot;
  fetch?: typeof fetch;
}): Promise<WorldModelBrief | undefined> {
  const apiKey = input.config.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    return undefined;
  }
  try {
    const openaiSettings: {
      apiKey: string;
      baseURL: string;
      name: string;
      fetch?: typeof fetch;
    } = {
      apiKey,
      baseURL: input.config.modelBaseUrl,
      name: "carina",
    };
    if (input.fetch !== undefined) {
      openaiSettings.fetch = input.fetch;
    }
    const openai = createOpenAI(openaiSettings);
    const last =
      input.last !== undefined
        ? `\nLast shot: shotKind=${input.last.shotKind ?? ""} prompt=${input.last.prompt ?? ""} style=${input.last.style ?? ""} camera=${input.last.camera ?? ""}`
        : "";
    const context =
      input.worldContext !== undefined && input.worldContext.length > 0
        ? `\nWorld context:\n${input.worldContext}`
        : "";
    const result = await generateText({
      model: openai.chat(input.config.model),
      system: [
        "You are the Carina / 龙骨 steward. Translate the user's line into a world-model instruction.",
        "Humans operate this product like a camera operator and a scene editor. Classify first:",
        '1) shotKind "camera": viewpoint or an element already in the picture (look at X, pan, tilt, closer, back up, face the bar/door/lantern). Keep the same place. fresh=false.',
        '2) shotKind "scene": establish or change the place itself (new location, dusk, rain, lighting, crowd, 生成/换成). Bake a new establishing shot. fresh=true.',
        "JSON only:",
        '{"shotKind":"camera"|"scene","prompt":"short title in the user language","style":"English first-person visual","camera":"English camera rig instruction","fresh":true,"reply":"one or two sentences in the user language"}',
        "style: English first-person visual. No UI verbs (看一眼, pause). No mesh IDs (墙西, 地板). For camera shots, start from the last place and describe framing only.",
        "camera: English camera/rig only (pan, tilt, dolly, what to face).",
        "prompt: short title of what they asked to see, in the user's language.",
        "reply: say whether you are moving the camera or changing the scene. Quote their request. Candidate view, not frozen geometry. Do not invent pixel details.",
        "Do not claim freeze or native 3D. LingBot output is observation only.",
        context,
        last,
      ].join("\n"),
      prompt: `World name: ${input.worldName}\nUser: ${input.text}`,
    });
    return parseWorldModelBrief(result.text, input);
  } catch {
    return undefined;
  }
}

function parseWorldModelBrief(
  raw: string,
  input: {
    text: string;
    worldName: string;
    config: CarinaConfig;
    last?: LastWorldModelShot;
  },
): WorldModelBrief | undefined {
  const json = extractJsonObject(raw);
  if (json === undefined) {
    return undefined;
  }
  const shotKind = json["shotKind"] === "camera" ? "camera" : "scene";
  const promptRaw = json["prompt"];
  const prompt =
    typeof promptRaw === "string" && promptRaw.trim().length > 0
      ? promptRaw.trim()
      : scenePrompt(input.text, input.worldName);
  const styleRaw = json["style"];
  const style =
    typeof styleRaw === "string" && styleRaw.trim().length > 0
      ? styleRaw.trim()
      : heuristicStyle(prompt, input.worldName);
  const cameraRaw = json["camera"];
  const camera =
    typeof cameraRaw === "string" && cameraRaw.trim().length > 0
      ? cameraRaw.trim()
      : heuristicCamera(input.text);
  const fresh =
    shotKind === "camera" ? json["fresh"] === true : json["fresh"] !== false;
  const replyRaw = json["reply"];
  const reply =
    typeof replyRaw === "string" && replyRaw.trim().length > 0
      ? replyRaw.trim()
      : formatViewReply(input.config.lang, shotKind, prompt);
  return { shotKind, prompt, style, camera, fresh, reply };
}
