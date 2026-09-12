import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CarinaError } from "../errors.js";
import { writeFileAtomic, encodeJson } from "../pack/open.js";
import {
  sessionRegistrySchema,
  type SessionRegistry,
} from "../schema/index.js";
import { isEnoent, nowIsoUtc } from "../world/ids.js";

const dataDirLocks = new Map<string, Promise<unknown>>();

/**
 * zh: 同一 dataDir 上的注册表与档案写入串行化。
 * en: Serialize registry and profile writes for one dataDir.
 */
export function withDataDirLock<T>(
  dataDir: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(dataDir);
  const previous = dataDirLocks.get(key) ?? Promise.resolve();
  const current = previous.then(
    () => task(),
    () => task(),
  );
  dataDirLocks.set(
    key,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

/**
 * zh: 注册表文件路径。
 * en: Path of the session registry file.
 */
export function registryPath(dataDir: string): string {
  return path.join(path.resolve(dataDir), "registry.json");
}

/**
 * zh: 读取注册表；没有文件则返回空表。
 * en: Read the registry; missing file yields an empty registry.
 */
export async function readRegistry(dataDir: string): Promise<SessionRegistry> {
  const filePath = registryPath(dataDir);
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return emptyRegistry();
    }
    throw new CarinaError("SESSION_INVALID", "error.sessionInvalid", error);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    throw new CarinaError("SESSION_INVALID", "error.sessionInvalid", error);
  }
  const parsed = sessionRegistrySchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new CarinaError(
      "SESSION_INVALID",
      "error.sessionInvalid",
      parsed.error,
    );
  }
  return parsed.data;
}

/**
 * zh: 原子写入注册表。
 * en: Atomically write the registry.
 */
export async function writeRegistry(
  dataDir: string,
  registry: SessionRegistry,
): Promise<void> {
  const parsed = sessionRegistrySchema.parse(registry);
  await mkdir(path.resolve(dataDir), { recursive: true });
  await writeFileAtomic(registryPath(dataDir), encodeJson(parsed));
}

/**
 * zh: 空注册表。
 * en: An empty session registry.
 */
export function emptyRegistry(): SessionRegistry {
  return {
    schemaVersion: 1,
    activeWorldId: null,
    worlds: [],
  };
}

/**
 * zh: 按 worldId 查找注册项。
 * en: Find a registry entry by worldId.
 */
export function findWorldById(
  registry: SessionRegistry,
  worldId: string,
): SessionRegistry["worlds"][number] | undefined {
  return registry.worlds.find((world) => world.worldId === worldId);
}

/**
 * zh: 按绝对 packDir 查找注册项。
 * en: Find a registry entry by resolved pack directory.
 */
export function findWorldByPackDir(
  registry: SessionRegistry,
  packDir: string,
): SessionRegistry["worlds"][number] | undefined {
  const resolved = path.resolve(packDir);
  return registry.worlds.find(
    (world) => path.resolve(world.packDir) === resolved,
  );
}

/**
 * zh: 插入或更新一条世界注册，并可设置 active 指针。
 * en: Upsert a world registry row and optionally set the active pointer.
 */
export function upsertWorldEntry(
  registry: SessionRegistry,
  entry: {
    worldId: string;
    name: string;
    packDir: string;
  },
  activeWorldId: string | null,
): SessionRegistry {
  const packDir = path.resolve(entry.packDir);
  const updatedAt = nowIsoUtc();
  const worlds = registry.worlds.filter(
    (world) =>
      world.worldId !== entry.worldId &&
      path.resolve(world.packDir) !== packDir,
  );
  worlds.push({
    worldId: entry.worldId,
    name: entry.name,
    packDir,
    updatedAt,
  });
  return {
    schemaVersion: 1,
    activeWorldId,
    worlds,
  };
}

/**
 * zh: 目录是否已有 graph.json。
 * en: Whether the directory already has graph.json.
 */
export async function packGraphExists(packDir: string): Promise<boolean> {
  try {
    await access(path.join(packDir, "graph.json"));
    return true;
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
}
