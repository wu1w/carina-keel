import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CarinaError } from "../errors.js";
import {
  commitRevision,
  createPack,
  ensureV1,
  openPack,
  readHead,
  readSnapshot,
  writeFileAtomic,
  type PackHandle,
} from "../pack/index.js";
import { encodeJson } from "../pack/open.js";
import type { WorldSessionRecord, WorldSnapshot } from "../schema/index.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";
import { globalProfileRefHash, readGlobalProfileUnlocked } from "./profile.js";
import {
  findWorldById,
  findWorldByPackDir,
  packGraphExists,
  readRegistry,
  upsertWorldEntry,
  withDataDirLock,
  writeRegistry,
} from "./registry.js";

export { readGlobalProfile, updateGlobalDocument } from "./profile.js";

/**
 * zh: 新建世界 session：建包、ensureV1、登记并设为当前世界。
 * en: Create a world session: create pack, ensureV1, register, and make it active.
 */
export async function createSession(input: {
  dataDir: string;
  lang: "zh" | "en";
  name: string;
  packDir?: string;
}): Promise<WorldSessionRecord> {
  if (input.name.length === 0) {
    throw new CarinaError("COMMAND_REJECTED", "error.commandRejected");
  }
  return withDataDirLock(input.dataDir, () => createSessionUnlocked(input));
}

/**
 * zh: 打开已登记世界并返回包句柄。
 * en: Open a registered world and return its pack handle.
 */
export async function openSession(
  dataDir: string,
  worldId: string,
): Promise<{ record: WorldSessionRecord; packDir: string; pack: PackHandle }> {
  return withDataDirLock(dataDir, () => openSessionUnlocked(dataDir, worldId));
}

/**
 * zh: 暂停当前世界并打开目标世界。打开失败时保留原注册表。
 * en: Suspend the current world and open the target. A failed open leaves the registry intact.
 */
export async function switchSession(
  dataDir: string,
  targetWorldId: string,
): Promise<WorldSessionRecord> {
  return withDataDirLock(dataDir, () =>
    switchSessionUnlocked(dataDir, targetWorldId),
  );
}

/**
 * zh: 暂停指定世界（runState=paused，lifecycle=suspended）。
 * en: Suspend a world (runState paused, lifecycle suspended).
 */
export async function suspendSession(
  dataDir: string,
  worldId: string,
): Promise<WorldSessionRecord> {
  return withDataDirLock(dataDir, () =>
    suspendSessionUnlocked(dataDir, worldId),
  );
}

/**
 * zh: 列出已登记世界；每条带 packDir。
 * en: List registered worlds; each row includes packDir.
 */
export async function listSessions(
  dataDir: string,
): Promise<Array<WorldSessionRecord & { packDir: string }>> {
  return withDataDirLock(dataDir, () => listSessionsUnlocked(dataDir));
}

/**
 * zh: 当前激活世界 id；没有则 undefined。
 * en: The active world id, or undefined if none.
 */
export async function getActiveWorldId(
  dataDir: string,
): Promise<string | undefined> {
  return withDataDirLock(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    if (registry.activeWorldId === null) {
      return undefined;
    }
    return registry.activeWorldId;
  });
}

/**
 * zh: 已持锁时创建 session。
 * en: Create a session while the dataDir lock is held.
 */
async function createSessionUnlocked(input: {
  dataDir: string;
  lang: "zh" | "en";
  name: string;
  packDir?: string;
}): Promise<WorldSessionRecord> {
  const dataDir = path.resolve(input.dataDir);
  const registry = await readRegistry(dataDir);
  const requestedPackDir =
    input.packDir !== undefined ? path.resolve(input.packDir) : undefined;
  if (requestedPackDir !== undefined) {
    const existingDir = findWorldByPackDir(registry, requestedPackDir);
    if (existingDir !== undefined) {
      return await switchSessionUnlocked(dataDir, existingDir.worldId);
    }
  }
  const { profile } = await readGlobalProfileUnlocked(dataDir, input.lang);
  const profileRef = globalProfileRefHash(profile);
  const packDir =
    requestedPackDir ?? path.join(dataDir, "worlds", `${createUlid()}.carina`);
  if (!(await packGraphExists(packDir))) {
    await mkdir(path.dirname(packDir), { recursive: true });
    await createPack(packDir, input.lang);
  }
  await ensureV1(packDir);
  const seeded = await readHeadSnapshot(packDir);
  const registered = findWorldById(registry, seeded.worldId);
  if (registered !== undefined) {
    return await switchSessionUnlocked(dataDir, registered.worldId);
  }
  if (registry.activeWorldId !== null) {
    await suspendWorldPack(dataDir, registry.activeWorldId);
  }
  const snapshot = await commitRevision({
    packDir,
    worldId: seeded.worldId,
    commandId: createUlid(),
    summary: "Create world session",
    mutate: (current) =>
      patchSession(current, {
        name: input.name,
        lifecycle: "active",
        runState: "paused",
        globalProfileRef: profileRef,
      }),
  });
  const record = snapshot.session;
  await writeRegistry(
    dataDir,
    upsertWorldEntry(
      await readRegistry(dataDir),
      {
        worldId: record.sessionId,
        name: record.name,
        packDir,
      },
      record.sessionId,
    ),
  );
  return record;
}

/**
 * zh: 已持锁时打开世界。
 * en: Open a world while the dataDir lock is held.
 */
async function openSessionUnlocked(
  dataDir: string,
  worldId: string,
): Promise<{ record: WorldSessionRecord; packDir: string; pack: PackHandle }> {
  const registry = await readRegistry(dataDir);
  const entry = findWorldById(registry, worldId);
  if (entry === undefined) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  const pack = await openPack(entry.packDir);
  const snapshot = await readHeadSnapshot(entry.packDir);
  return {
    record: snapshot.session,
    packDir: path.resolve(entry.packDir),
    pack,
  };
}

/**
 * zh: 已持锁时切换世界。先暂停旧世界，成功打开后再移动 active 指针。
 * en: Switch worlds while locked. Suspend the old world first; move the active pointer only after a successful open.
 */
async function switchSessionUnlocked(
  dataDir: string,
  targetWorldId: string,
): Promise<WorldSessionRecord> {
  const registry = await readRegistry(dataDir);
  const target = findWorldById(registry, targetWorldId);
  if (target === undefined) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  const currentId = registry.activeWorldId;
  if (currentId !== null && currentId !== targetWorldId) {
    await suspendWorldPack(dataDir, currentId);
  }
  const pack = await openPack(target.packDir);
  const currentSnap = await readHeadSnapshot(pack.packDir);
  const snapshot = await commitRevision({
    packDir: pack.packDir,
    worldId: currentSnap.worldId,
    commandId: createUlid(),
    summary: "Activate world session",
    mutate: (current) =>
      patchSession(current, {
        lifecycle: "active",
        runState: "paused",
        controlEpoch: current.controlEpoch + 1,
      }),
  });
  await writeRegistry(
    dataDir,
    upsertWorldEntry(
      await readRegistry(dataDir),
      {
        worldId: snapshot.worldId,
        name: snapshot.session.name,
        packDir: pack.packDir,
      },
      snapshot.worldId,
    ),
  );
  return snapshot.session;
}

/**
 * zh: 已持锁时暂停世界。
 * en: Suspend a world while the dataDir lock is held.
 */
async function suspendSessionUnlocked(
  dataDir: string,
  worldId: string,
): Promise<WorldSessionRecord> {
  const registry = await readRegistry(dataDir);
  const entry = findWorldById(registry, worldId);
  if (entry === undefined) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  const snapshot = await suspendWorldPack(dataDir, worldId);
  await writeRegistry(
    dataDir,
    upsertWorldEntry(
      await readRegistry(dataDir),
      {
        worldId,
        name: snapshot.session.name,
        packDir: entry.packDir,
      },
      registry.activeWorldId,
    ),
  );
  return snapshot.session;
}

/**
 * zh: 已持锁时列出世界。
 * en: List worlds while the dataDir lock is held.
 */
async function listSessionsUnlocked(
  dataDir: string,
): Promise<Array<WorldSessionRecord & { packDir: string }>> {
  const registry = await readRegistry(dataDir);
  const rows: Array<WorldSessionRecord & { packDir: string }> = [];
  for (const entry of registry.worlds) {
    await ensureV1(entry.packDir);
    const snapshot = await readHeadSnapshot(entry.packDir);
    rows.push({
      ...snapshot.session,
      packDir: path.resolve(entry.packDir),
    });
  }
  return rows;
}

/**
 * zh: 暂停包内世界：paused + suspended，并写检查点。不移动 active 指针。
 * en: Pause the pack: paused + suspended, and write a checkpoint. Does not move the active pointer.
 */
async function suspendWorldPack(
  dataDir: string,
  worldId: string,
): Promise<WorldSnapshot> {
  const registry = await readRegistry(dataDir);
  const entry = findWorldById(registry, worldId);
  if (entry === undefined) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  await ensureV1(entry.packDir);
  const current = await readHeadSnapshot(entry.packDir);
  const snapshot = await commitRevision({
    packDir: entry.packDir,
    worldId: current.worldId,
    commandId: createUlid(),
    summary: "Suspend world session",
    mutate: (head) =>
      patchSession(head, {
        lifecycle: "suspended",
        runState: "paused",
        controlEpoch: head.controlEpoch + 1,
      }),
  });
  await writeFileAtomic(
    path.join(entry.packDir, "checkpoints", `${snapshot.revision}.json`),
    encodeJson({
      checkpointId: snapshot.revision,
      kind: "suspend",
      createdAt: nowIsoUtc(),
    }),
  );
  await writeRegistry(
    dataDir,
    upsertWorldEntry(
      await readRegistry(dataDir),
      {
        worldId: snapshot.worldId,
        name: snapshot.session.name,
        packDir: entry.packDir,
      },
      registry.activeWorldId,
    ),
  );
  return snapshot;
}

/**
 * zh: 读取 HEAD 对应快照。
 * en: Read the snapshot pointed to by HEAD.
 */
async function readHeadSnapshot(packDir: string): Promise<WorldSnapshot> {
  const head = await readHead(packDir);
  return readSnapshot(packDir, head.revision);
}

/**
 * zh: 覆盖 session 字段，并同步顶层 simTime / controlEpoch。
 * en: Patch session fields and keep top-level simTime / controlEpoch in sync.
 */
function patchSession(
  snapshot: WorldSnapshot,
  patch: Partial<WorldSessionRecord> & {
    controlEpoch?: number;
  },
): WorldSnapshot {
  const controlEpoch = patch.controlEpoch ?? snapshot.controlEpoch;
  const simTime = patch.simTime ?? snapshot.simTime;
  const nextSession: WorldSessionRecord = {
    ...snapshot.session,
    ...patch,
    controlEpoch,
    simTime,
  };
  if (nextSession.thumbnailPosix === undefined) {
    delete nextSession.thumbnailPosix;
  }
  return {
    ...snapshot,
    controlEpoch,
    simTime,
    session: nextSession,
  };
}
