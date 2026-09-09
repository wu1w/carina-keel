import { resolve } from "node:path";
import { loadConfig, type CarinaConfig } from "../config.js";
import { CarinaError } from "../errors.js";

/**
 * zh: 用 CLI 参数覆盖 CARINA_PACK。
 * en: Override CARINA_PACK with a CLI argument.
 */
export function resolveConfig(packArg: string | undefined): CarinaConfig {
  const config = loadConfig();
  if (packArg === undefined || packArg === "") {
    return config;
  }
  return { ...config, pack: resolve(packArg) };
}

/**
 * zh: 取出世界包路径，缺则抛 CONFIG。
 * en: Require a world pack path or throw CONFIG.
 */
export function requirePackPath(config: CarinaConfig): string {
  if (config.pack === undefined || config.pack === "") {
    throw new CarinaError("CONFIG", "error.config");
  }
  return config.pack;
}
