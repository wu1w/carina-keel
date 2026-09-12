import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { sessionRegistrySchema } from "../../schema/index.js";
import {
  closeApplication,
  normalizeSessionList,
  tryCreateApplication,
} from "../../server/bind-application.js";
import { resolveConfig } from "../resolve-config.js";
import { runSafely } from "../run-safely.js";

const lang = loadConfig().lang;

/**
 * zh: 列出 dataDir 中已注册的世界。不需要包路径。
 * en: List registered worlds in dataDir. No pack path required.
 */
export const sessionsCommand = defineCommand({
  meta: {
    name: "sessions",
    description: t("cli.sessions", lang),
  },
  async run() {
    await runSafely(lang, async () => {
      const config = resolveConfig(undefined);
      const application = await tryCreateApplication(config);
      try {
        if (application !== undefined) {
          const listed = normalizeSessionList(await application.listSessions());
          console.log(JSON.stringify(listed, null, 2));
          return;
        }
        const listed = await readRegistry(config.dataDir);
        console.log(JSON.stringify(listed, null, 2));
      } finally {
        await closeApplication(application);
      }
    });
  },
});

/**
 * zh: 从 dataDir/registry.json 读世界列表。
 * en: Read the world list from dataDir/registry.json.
 */
async function readRegistry(dataDir: string): Promise<{
  worlds: Array<{
    worldId: string;
    name: string;
    runState: string;
    lifecycle: string;
    updatedAt: string;
  }>;
  activeWorldId: string | null;
}> {
  try {
    const raw = await readFile(join(dataDir, "registry.json"), "utf8");
    const parsed = sessionRegistrySchema.parse(JSON.parse(raw) as unknown);
    return {
      activeWorldId: parsed.activeWorldId,
      worlds: parsed.worlds.map((world) => ({
        worldId: world.worldId,
        name: world.name,
        runState: "paused",
        lifecycle: "active",
        updatedAt: world.updatedAt,
      })),
    };
  } catch {
    return { worlds: [], activeWorldId: null };
  }
}
