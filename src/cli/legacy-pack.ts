import type { CarinaConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { requirePackPath, resolveConfig } from "./resolve-config.js";
import { printStatus } from "./run-safely.js";

const lang = loadConfig().lang;

/**
 * zh: 旧八工具只在明确给了世界包时跑。没有包就指向 chat，不再假装产品入口要 Place id。
 * en: Legacy eight-tools run only with an explicit pack. Without a pack, point at chat instead of implying Place id is the product.
 */
export async function runWithLegacyPack(
  packArg: string | undefined,
  fn: (packDir: string, config: CarinaConfig) => Promise<void>,
): Promise<void> {
  const config = resolveConfig(packArg);
  let packDir: string;
  try {
    packDir = requirePackPath(config);
  } catch {
    printStatus("cli.leftoverUseChat", lang);
    process.exitCode = 1;
    return;
  }
  await fn(packDir, config);
}
