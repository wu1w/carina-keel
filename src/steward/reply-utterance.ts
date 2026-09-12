import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { CarinaConfig } from "../config.js";

/**
 * zh: 管家口播输入。失败返回空字符串，不假装已执行。
 * en: Steward spoken-reply input. Failures return "" and never claim work ran.
 */
export type ReplyUtteranceInput = {
  text: string;
  config: CarinaConfig;
  worldContext?: string;
  fetch?: typeof fetch;
};

/**
 * zh: 用户只是在问或闲聊时，生成一句管家回复。
 * en: Speak when the user is asking or chatting, not when they issued a world command.
 */
export async function replyUtterance(
  input: ReplyUtteranceInput,
): Promise<string> {
  const apiKey = input.config.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    return "";
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
        "You are the Carina / 龙骨 steward speaking to the creator.",
        "Answer in the user's language. Be concise. Lead with the conclusion.",
        "Do not claim generation, freeze, or geometry updates unless they already committed.",
        "LingBot stills and clips are candidate observations, never frozen 3D.",
        "Do not run host shell or browser commands.",
        context,
      ].join("\n"),
      prompt: input.text,
    });
    return result.text.trim();
  } catch {
    return "";
  }
}
