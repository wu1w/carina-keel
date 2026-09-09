/**
 * zh: 界面语言。
 * en: UI language.
 */
export type CarinaLang = "zh" | "en";

/**
 * zh: 进程配置。只在本文件读环境变量。
 * en: Process config. Only this file reads environment variables.
 */
export type CarinaConfig = {
  apiKey: string | undefined;
  model: string;
  modelBaseUrl: string;
  token: string;
  port: number;
  pack: string | undefined;
  lang: CarinaLang;
};

/**
 * zh: 从环境变量读取配置。
 * en: Load config from environment variables.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): CarinaConfig {
  const langRaw = env["CARINA_LANG"] ?? "zh";
  const lang: CarinaLang = langRaw === "en" ? "en" : "zh";
  const portRaw = env["CARINA_PORT"] ?? "18790";
  const port = Number.parseInt(portRaw, 10);
  return {
    apiKey: env["CARINA_API_KEY"] ?? env["OPENAI_API_KEY"],
    model: env["CARINA_MODEL"] ?? "gpt-4o-mini",
    modelBaseUrl: env["CARINA_MODEL_BASE_URL"] ?? "https://api.openai.com/v1",
    token: env["CARINA_TOKEN"] ?? "dev-token",
    port: Number.isFinite(port) ? port : 18790,
    pack: env["CARINA_PACK"],
    lang,
  };
}
