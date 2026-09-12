import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { CarinaConfig } from "../config.js";
import {
  intentKindSchema,
  type IntentKind,
  type WorldCommand,
} from "../schema/index.js";
import { createUlid } from "../world/ids.js";
import { extractJsonObject } from "./json.js";

export { extractJsonObject } from "./json.js";

/**
 * zh: 管家一轮：要执行的命令，以及已经转译好的那句人话。
 * en: One steward turn: commands to run, plus the spoken line.
 */
export type StewardTurn = {
  commands: WorldCommand[];
  reply?: string;
};

/**
 * zh: 管家把一句话转成 WorldCommand。失败返回空命令，不假装已执行。
 * en: Steward maps a sentence to WorldCommand. Failures return no commands; never claim work ran.
 */
export type InterpretCommandInput = {
  text: string;
  origin: WorldCommand["origin"];
  requestedBy: string;
  worldId?: string;
  config: CarinaConfig;
  worldContext?: string;
  fetch?: typeof fetch;
};

const INTENT_KINDS = intentKindSchema.options;

/**
 * zh: 有 apiKey 时请模型产出 JSON 命令；失败或无 key 返回空 turn。
 * en: With an apiKey, ask the model for JSON commands; on failure or no key return an empty turn.
 */
export async function interpretCommand(
  input: InterpretCommandInput,
): Promise<StewardTurn> {
  const apiKey = input.config.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    return { commands: [] };
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
    const context =
      input.worldContext !== undefined && input.worldContext.length > 0
        ? `\nWorld context:\n${input.worldContext}`
        : "";
    const result = await generateText({
      model: openai.chat(input.config.model),
      system: [
        "You are the Carina / 龙骨 steward. Judge the user's intent, then emit JSON only.",
        '{"reply":"...","commands":[{"intentKind":"...","arguments":{},"mode":"author"|"player"}]}',
        `intentKind must be one of: ${INTENT_KINDS.join(", ")}`,
        "Humans operate this product like a camera operator and a scene editor. Optimize these two intents first:",
        "1) CAMERA — viewpoint or an element in the current picture (看向/望向/往左/往右/靠近/拉近/镜头/看吧台/看那扇门, look at, pan, tilt, zoom). → generation.start with arguments {observeOnly:true, shotKind:\"camera\", fresh:false, prompt, style, camera}. Keep the same place. style is English first-person visual that preserves the last scene and only changes framing. camera is English rig instruction (what to face, pan/tilt/dolly).",
        "2) SCENE — establish or adjust the place (生成/做一间/换成/黄昏/下雨/光线/人群, new location, dusk, rain). → generation.start with arguments {observeOnly:true, shotKind:\"scene\", fresh:true, prompt, style, camera}. style is English first-person visual of the new or adjusted place. camera defaults to eye-level first-person.",
        "A comma-separated place description (湖边，夕阳，酒馆) is SCENE, not chat.",
        "Do NOT copy the user's raw sentence, UI verbs (看一眼, pause), or mesh names (墙西, 地板) into style.",
        "prompt: short title in the user's language of what they asked to see.",
        "reply: one or two sentences in the user's language. Say camera vs scene. Quote the request. Candidate view, not frozen. Do not invent pixel details.",
        "Create a world → session.create with arguments.name. Then the app will look; still fill style/prompt if the name is a place.",
        "Pause/resume/step the world clock with world.pause / world.run / world.step. No world-model style.",
        "Move as the player through committed mesh → player.navigate. Walking toward something in the picture is CAMERA, not mesh navigation.",
        "chat.utterance is only for questions that need a spoken answer and no camera/scene change.",
        "Do not emit generation.start without observeOnly. LingBot video is observation only. Never claim freeze or native 3D from video.",
        "Do not claim that work already happened. Output commands to run, not results.",
        context,
      ].join("\n"),
      prompt: input.text,
    });
    return parseStewardTurn(result.text, input);
  } catch {
    return { commands: [] };
  }
}

/**
 * zh: 解析管家 JSON。供测试直接喂样本。
 * en: Parse steward JSON. Tests can feed a sample directly.
 */
export function parseStewardTurn(
  raw: string,
  input: InterpretCommandInput,
): StewardTurn {
  const json = extractJsonObject(raw);
  if (json === undefined) {
    return { commands: [] };
  }
  const replyRaw = json["reply"];
  const reply =
    typeof replyRaw === "string" && replyRaw.trim().length > 0
      ? replyRaw.trim()
      : undefined;
  const commandsRaw = json["commands"];
  if (!Array.isArray(commandsRaw)) {
    return reply !== undefined ? { commands: [], reply } : { commands: [] };
  }
  const commands: WorldCommand[] = [];
  for (const item of commandsRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const parsedKind = intentKindSchema.safeParse(row["intentKind"]);
    if (!parsedKind.success) {
      continue;
    }
    const intentKind: IntentKind = parsedKind.data;
    const args =
      typeof row["arguments"] === "object" &&
      row["arguments"] !== null &&
      !Array.isArray(row["arguments"])
        ? { ...(row["arguments"] as Record<string, unknown>) }
        : {};
    if (intentKind === "generation.start" && args["rewriteMesh"] !== true) {
      args["observeOnly"] = true;
    }
    if (reply !== undefined && typeof args["reply"] !== "string") {
      args["reply"] = reply;
    }
    const mode = row["mode"] === "player" ? "player" : defaultMode(intentKind);
    const base: WorldCommand = {
      commandId: createUlid(),
      intentKind,
      arguments: args,
      origin: input.origin,
      mode,
      requestedBy: input.requestedBy,
      text: input.text,
    };
    const worldId =
      typeof row["worldId"] === "string" ? row["worldId"] : input.worldId;
    if (worldId !== undefined) {
      commands.push({ ...base, worldId });
    } else {
      commands.push(base);
    }
  }
  if (reply !== undefined) {
    return { commands, reply };
  }
  return { commands };
}

function defaultMode(intentKind: IntentKind): WorldCommand["mode"] {
  if (intentKind.startsWith("player.")) {
    return "player";
  }
  return "author";
}
