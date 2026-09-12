import { homedir } from "node:os";
import path from "node:path";

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
  /**
   * zh: 应用数据目录。放全局档案与世界注册表。
   * en: App data directory for the global profile and world registry.
   */
  dataDir: string;
  /**
   * zh: 静帧 sidecar 根 URL。未设则 look 走 MockRenderer。
   * en: Still-frame sidecar root URL. Unset keeps look on MockRenderer.
   */
  rendererUrl?: string;
  /** Independent, optional CPU depth service for image-based exploration. */
  depthUrl?: string;
  rtxServiceUrl?: string;
  rtxServiceKeyFile?: string;
  /**
   * zh: 原生网格 HTTP 适配器根 URL。空字符串视为未设置，走 mock。
   * en: Native-mesh HTTP adapter root URL. Empty string is unset and keeps the mock.
   */
  meshProviderUrl?: string;
  /**
   * zh: Bearer 密钥文件路径。不要把文件内容写进仓库或日志。
   * en: Path to a Bearer token file. Do not write the contents into the repo or logs.
   */
    meshProviderKeyFile?: string;
    /**
     * zh: Windows WorldRuntime 根 URL（经 SSH 隧道的 127.0.0.1:18794）。
     * en: Windows WorldRuntime root URL (127.0.0.1:18794 via SSH tunnel).
     */
    worldRuntimeUrl?: string;
    /**
     * zh: 上传后是否 cook/install/activate/spawn。缺省只上传。
     * en: After upload, whether to cook/install/activate/spawn. Default false.
     */
    worldRuntimeCook?: boolean;
    /**
     * zh: SolarWM 源码根目录。未设则支线记 blocked-no-runtime。有目录也不把视频写成网格。
     * en: SolarWM source root. Unset records blocked-no-runtime. A tree still does not make video a mesh.
     */
    solarWmRoot?: string;
    explorationBudget?: number;
  explorationWarmupViews?: number;
  /**
   * zh: LAN Pixel Streaming 播放根 URL。默认家里 Windows 串流。
   * en: LAN Pixel Streaming player root URL. Defaults to the home Windows stream.
   */
  pixelStreamingUrl?: string;
};

/** zh: 家里 Windows PS2 播放根。 en: Home Windows PS2 player root. */
export const DEFAULT_PIXEL_STREAMING_URL = "http://192.168.5.16:8080";

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
  const rendererUrl = emptyToUndefined(env["CARINA_RENDERER_URL"]);
  const dataDir =
    emptyToUndefined(env["CARINA_DATA_DIR"]) ??
    path.join(homedir(), ".carina");
  return {
    apiKey: env["CARINA_API_KEY"] ?? env["OPENAI_API_KEY"],
    model: env["CARINA_MODEL"] ?? "gpt-4o-mini",
    modelBaseUrl: env["CARINA_MODEL_BASE_URL"] ?? "https://api.openai.com/v1",
    token: env["CARINA_TOKEN"] ?? "dev-token",
    port: Number.isFinite(port) ? port : 18790,
    pack: env["CARINA_PACK"],
    lang,
    dataDir,
    ...(rendererUrl !== undefined ? { rendererUrl } : {}),
    ...(emptyToUndefined(env["CARINA_DEPTH_URL"]) !== undefined
      ? { depthUrl: env["CARINA_DEPTH_URL"]! } : {}),
    ...(emptyToUndefined(env["CARINA_RTX_SERVICE_URL"]) ? { rtxServiceUrl: env["CARINA_RTX_SERVICE_URL"]! } : {}),
    ...(emptyToUndefined(env["CARINA_RTX_SERVICE_KEY_FILE"]) ? { rtxServiceKeyFile: env["CARINA_RTX_SERVICE_KEY_FILE"]! } : {}),
    ...(emptyToUndefined(env["CARINA_MESH_PROVIDER_URL"])
      ? { meshProviderUrl: env["CARINA_MESH_PROVIDER_URL"]! }
      : {}),
    ...(emptyToUndefined(env["CARINA_MESH_PROVIDER_KEY_FILE"])
      ? { meshProviderKeyFile: env["CARINA_MESH_PROVIDER_KEY_FILE"]! }
      : {}),
    ...(emptyToUndefined(env["CARINA_WORLD_RUNTIME_URL"])
      ? { worldRuntimeUrl: env["CARINA_WORLD_RUNTIME_URL"]! }
      : {}),
    ...(env["CARINA_WORLD_RUNTIME_COOK"] === "1"
      ? { worldRuntimeCook: true }
      : {}),
    ...(emptyToUndefined(env["CARINA_SOLARWM_ROOT"])
      ? { solarWmRoot: env["CARINA_SOLARWM_ROOT"]! }
      : {}),
    explorationBudget: boundedInt(env["CARINA_EXPLORATION_BUDGET"], 192, 24, 1024),
    explorationWarmupViews: boundedInt(env["CARINA_WARMUP_VIEWS"], 24, 24, 128),
    pixelStreamingUrl:
      emptyToUndefined(env["CARINA_PIXEL_STREAMING_URL"]) ??
      DEFAULT_PIXEL_STREAMING_URL,
  };
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const number=Number(value);
  return value && Number.isInteger(number) ? Math.max(min,Math.min(max,number)) : fallback;
}

/**
 * zh: 空字符串当成未设置。
 * en: Treat an empty string as unset.
 */
function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}
