import { readFile } from "node:fs/promises";
import path from "node:path";
import { CarinaError } from "../errors.js";
import {
  commitRecordSchema,
  headFileSchema,
  WORLD_DOCUMENT_IDS,
  worldSnapshotSchema,
  type HeadFile,
  type SessionFile,
  type WorldSnapshot,
} from "../schema/index.js";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";
import { sha256Hex } from "./hash.js";
import {
  ensureV1Directories,
  headFileExists,
  LOGICAL_PROJECTION_FILES,
  migrateV0ToV1,
  normalizeAssetExt,
  normalizeLf,
  readSessionProjection,
  readWorldDocumentBodies,
  snapshotPosix,
  stageLogicalProjections,
  WORLD_DOCUMENT_FILES,
  writeCommitFile,
  writeContentAddressedAsset,
  writeHeadFile,
  writeSnapshotFile,
  type WorldDocumentFile,
} from "./migrate-v1.js";
import { encodeJson, writeFileAtomic } from "./open.js";
import { resolvePosix } from "./paths.js";
import { isNodeErrno } from "./sandbox.js";

const packWriteQueues = new Map<string, Promise<unknown>>();

const LOGICAL_FILE_SET = new Set<string>(LOGICAL_PROJECTION_FILES);

/**
 * zh: 若尚无 HEAD.json，则从当前 graph/session/Markdown 建立第一份 revision。
 * en: If HEAD.json is missing, create the first revision from current graph/session/markdown.
 */
export async function ensureV1(packDir: string): Promise<void> {
  const resolved = path.resolve(packDir);
  return withPackWriteLock(resolved, async () => {
    if (await headFileExists(resolved)) {
      return;
    }
    await migrateV0ToV1(resolved);
  });
}

/**
 * zh: 读取 HEAD 指针。
 * en: Read the HEAD pointer.
 */
export async function readHead(packDir: string): Promise<HeadFile> {
  const filePath = path.join(path.resolve(packDir), "HEAD.json");
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
  const parsed = headFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new CarinaError("PACK_INVALID", "error.packInvalid", parsed.error);
  }
  return parsed.data;
}

/**
 * zh: 读取某次 revision 的一致快照。
 * en: Read the consistent snapshot for a revision.
 */
export async function readSnapshot(
  packDir: string,
  revision: string,
): Promise<WorldSnapshot> {
  const filePath = resolvePosix(path.resolve(packDir), snapshotPosix(revision));
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("NOT_FOUND", "error.notFound", error);
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
  const parsed = worldSnapshotSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new CarinaError("PACK_INVALID", "error.packInvalid", parsed.error);
  }
  return parsed.data;
}

/**
 * zh: 把字节按内容寻址写入 assets/<sha256>.<ext>。在更新 HEAD 之前持久化。
 * en: Stage bytes at assets/<sha256>.<ext>. Persist before updating HEAD.
 */
export async function stageAsset(
  packDir: string,
  bytes: Uint8Array,
  ext: string,
): Promise<{ hash: string; posixPath: string }> {
  const resolved = path.resolve(packDir);
  return withPackWriteLock(resolved, async () => {
    await ensureV1Directories(resolved);
    return writeContentAddressedAsset(resolved, bytes, ext);
  });
}

/**
 * zh: 读取内容寻址资产。hash 必须是 64 位十六进制。
 * en: Read a content-addressed asset. Hash must be 64 hex characters.
 */
export async function readAsset(
  packDir: string,
  hash: string,
  ext: string,
): Promise<Uint8Array> {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new CarinaError("SANDBOX", "error.sandbox");
  }
  const posixPath = `assets/${hash}.${normalizeAssetExt(ext)}`;
  const filePath = resolvePosix(path.resolve(packDir), posixPath);
  const bytes = await readFile(filePath).catch((error: unknown) => {
    if (isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("NOT_FOUND", "error.notFound", error);
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  });
  return bytes;
}

/**
 * zh: 对当前 HEAD 应用 mutate 并提交新 revision。同一 packDir 串行写入。
 * en: Apply mutate to HEAD and commit a new revision. Writes for one packDir are serialized.
 */
export async function commitRevision(input: {
  packDir: string;
  worldId: string;
  commandId: string;
  summary: string;
  mutate: (current: WorldSnapshot) => WorldSnapshot;
}): Promise<WorldSnapshot> {
  const resolved = path.resolve(input.packDir);
  return withPackWriteLock(resolved, () =>
    commitRevisionUnlocked({ ...input, packDir: resolved }),
  );
}

/**
 * zh: 从目标 revision 拷贝快照，新建提交（parent 为当前 HEAD），保留历史。
 * en: Restore a checkpoint by copying that snapshot into a new commit whose parent is current HEAD.
 */
export async function restoreCheckpoint(
  packDir: string,
  revision: string,
): Promise<WorldSnapshot> {
  const resolved = path.resolve(packDir);
  return withPackWriteLock(resolved, () =>
    restoreCheckpointUnlocked(resolved, revision),
  );
}

/**
 * zh: 读取本世界规则文档正文与哈希。
 * en: Read this world's rule document bodies and hashes.
 */
export async function readWorldDocuments(
  packDir: string,
): Promise<Record<string, { body: string; hash: string }>> {
  await ensureV1(packDir);
  return readWorldDocumentBodies(path.resolve(packDir));
}

/**
 * zh: 更新一份本世界规则文档并提交。expectedHash 不匹配则拒绝。
 * en: Update one world rule document and commit. Reject when expectedHash does not match.
 */
export async function updateWorldDocument(
  packDir: string,
  documentId: string,
  body: string,
  expectedHash?: string,
): Promise<{ hash: string }> {
  const resolved = path.resolve(packDir);
  if (!isWorldDocumentFile(documentId)) {
    throw new CarinaError("RULES_INVALID", "error.rulesInvalid");
  }
  return withPackWriteLock(resolved, async () => {
    if (!(await headFileExists(resolved))) {
      await migrateV0ToV1(resolved);
    }
    const currentDocs = await readWorldDocumentBodies(resolved);
    const current = currentDocs[documentId];
    if (current === undefined) {
      throw new CarinaError("NOT_FOUND", "error.notFound");
    }
    if (expectedHash !== undefined && current.hash !== expectedHash) {
      throw new CarinaError("RULES_INVALID", "error.rulesInvalid");
    }
    const lfBody = normalizeLf(body);
    const hash = sha256Hex(lfBody);
    await writeFileAtomic(resolvePosix(resolved, documentId), lfBody);
    const head = await readHead(resolved);
    const snapshot = await readSnapshot(resolved, head.revision);
    await commitRevisionUnlocked({
      packDir: resolved,
      worldId: snapshot.worldId,
      commandId: createUlid(),
      summary: `Update ${documentId}`,
      mutate: (currentSnapshot) => currentSnapshot,
    });
    return { hash };
  });
}

/**
 * zh: 同一 packDir 上的写入排成一条 Promise 链。
 * en: Serialize writes for one packDir on a promise chain.
 */
function withPackWriteLock<T>(
  packDir: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(packDir);
  const previous = packWriteQueues.get(key) ?? Promise.resolve();
  const current = previous.then(
    () => task(),
    () => task(),
  );
  packWriteQueues.set(
    key,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

/**
 * zh: 已持锁时提交。资产先落盘，最后才更新 HEAD。
 * en: Commit while the pack lock is held. Persist assets first; update HEAD last.
 */
async function commitRevisionUnlocked(input: {
  packDir: string;
  worldId: string;
  commandId: string;
  summary: string;
  mutate: (current: WorldSnapshot) => WorldSnapshot;
}): Promise<WorldSnapshot> {
  await ensureV1Directories(input.packDir);
  if (!(await headFileExists(input.packDir))) {
    await migrateV0ToV1(input.packDir);
  }
  const head = await readHead(input.packDir);
  const current = await readSnapshot(input.packDir, head.revision);
  if (current.worldId !== input.worldId) {
    throw new CarinaError("CONFLICT", "error.conflict");
  }
  let mutated: WorldSnapshot;
  try {
    mutated = input.mutate(structuredClone(current));
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("COMMAND_REJECTED", "error.commandRejected", error);
  }
  const parsedMutated = worldSnapshotSchema.safeParse(mutated);
  if (!parsedMutated.success) {
    throw new CarinaError(
      "COMMAND_REJECTED",
      "error.commandRejected",
      parsedMutated.error,
    );
  }
  const revision = createUlid();
  const createdAt = nowIsoUtc();
  const documents = await readWorldDocumentBodies(input.packDir);
  const sessionFile = await readSessionProjection(input.packDir);
  const logicalManifest = await stageLogicalProjections(
    input.packDir,
    documents,
    sessionFile,
  );
  const carriedAssets = parsedMutated.data.assetManifest.filter(
    (entry) => !LOGICAL_FILE_SET.has(entry.posixPath),
  );
  const worldDoc = documents[WORLD_DOCUMENT_IDS.world];
  if (worldDoc === undefined) {
    throw new CarinaError("PACK_INVALID", "error.packInvalid");
  }
  const worldRules =
    worldDoc.hash === parsedMutated.data.worldRules.sourceHash
      ? { ...parsedMutated.data.worldRules, revision }
      : compileWorldRules(worldDoc.body, revision, worldDoc.hash);
  const ruleDocumentRefs: Record<string, string> = {
    ...parsedMutated.data.session.ruleDocumentRefs,
  };
  for (const documentId of WORLD_DOCUMENT_FILES) {
    const doc = documents[documentId];
    if (doc === undefined) {
      continue;
    }
    ruleDocumentRefs[documentId] = doc.hash;
  }
  const nextSession = stripUndefinedSessionFields({
    ...parsedMutated.data.session,
    sessionId: input.worldId,
    schemaVersion: 1,
    createdAt: current.session.createdAt,
    headRevision: revision,
    updatedAt: createdAt,
    simTime: parsedMutated.data.simTime,
    controlEpoch: parsedMutated.data.controlEpoch,
    ruleDocumentRefs,
    worldRulesRef: WORLD_DOCUMENT_IDS.world,
  });
  const snapshot = worldSnapshotSchema.parse({
    ...parsedMutated.data,
    revision,
    parentRevision: current.revision,
    worldId: input.worldId,
    createdAt,
    session: nextSession,
    worldRules,
    simTime: parsedMutated.data.simTime,
    controlEpoch: parsedMutated.data.controlEpoch,
    assetManifest: [...carriedAssets, ...logicalManifest],
  });
  const commit = commitRecordSchema.parse({
    revision,
    parentRevision: current.revision,
    worldId: input.worldId,
    commandId: input.commandId,
    createdAt,
    snapshotPosix: snapshotPosix(revision),
    ruleHashes: ruleHashesFromDocs(documents),
    summary: input.summary,
  });
  await persistCommittedSnapshot(input.packDir, snapshot, commit, sessionFile);
  return snapshot;
}

/**
 * zh: 新提交拷贝目标快照，parent 指向当前 HEAD。
 * en: New commit copies the target snapshot; parent points at current HEAD.
 */
async function restoreCheckpointUnlocked(
  packDir: string,
  revision: string,
): Promise<WorldSnapshot> {
  await ensureV1Directories(packDir);
  if (!(await headFileExists(packDir))) {
    await migrateV0ToV1(packDir);
  }
  const head = await readHead(packDir);
  const current = await readSnapshot(packDir, head.revision);
  const target = await readSnapshot(packDir, revision);
  await restoreLogicalFilesFromManifest(packDir, target);
  const newRevision = createUlid();
  const createdAt = nowIsoUtc();
  const controlEpoch = current.controlEpoch + 1;
  const nextSession = stripUndefinedSessionFields({
    ...target.session,
    sessionId: current.worldId,
    schemaVersion: 1,
    headRevision: newRevision,
    controlEpoch,
    simTime: target.simTime,
    lifecycle: "active",
    runState: "paused",
    updatedAt: createdAt,
  });
  const snapshot = worldSnapshotSchema.parse({
    ...target,
    revision: newRevision,
    parentRevision: current.revision,
    worldId: current.worldId,
    createdAt,
    session: nextSession,
    worldRules: { ...target.worldRules, revision: newRevision },
    simTime: target.simTime,
    controlEpoch,
  });
  const documents = await readWorldDocumentBodies(packDir);
  const sessionFile = await readSessionProjection(packDir);
  const logicalManifest = await stageLogicalProjections(
    packDir,
    documents,
    sessionFile,
  );
  const carriedAssets = target.assetManifest.filter(
    (entry) => !LOGICAL_FILE_SET.has(entry.posixPath),
  );
  const restored: WorldSnapshot = worldSnapshotSchema.parse({
    ...snapshot,
    assetManifest: [...carriedAssets, ...logicalManifest],
  });
  const commit = commitRecordSchema.parse({
    revision: newRevision,
    parentRevision: current.revision,
    worldId: current.worldId,
    commandId: createUlid(),
    createdAt,
    snapshotPosix: snapshotPosix(newRevision),
    ruleHashes: ruleHashesFromDocs(documents),
    summary: `Restore checkpoint ${revision}`,
  });
  await writeFileAtomic(
    resolvePosix(packDir, `checkpoints/${newRevision}.json`),
    encodeJson({
      checkpointId: newRevision,
      restoredFrom: revision,
      createdAt,
    }),
  );
  await persistCommittedSnapshot(packDir, restored, commit, sessionFile);
  return restored;
}

/**
 * zh: 写入快照、提交记录、投影，最后更新 HEAD。
 * en: Write snapshot, commit record, projections, then HEAD.
 */
async function persistCommittedSnapshot(
  packDir: string,
  snapshot: WorldSnapshot,
  commit: {
    revision: string;
    parentRevision: string | null;
    worldId: string;
    commandId: string;
    createdAt: string;
    snapshotPosix: string;
    ruleHashes: Record<string, string>;
    summary: string;
  },
  sessionFile: SessionFile,
): Promise<void> {
  await writeSceneSidecars(packDir, snapshot);
  await writeSnapshotFile(packDir, snapshot);
  await writeCommitFile(packDir, commit);
  await writeFileAtomic(
    path.join(packDir, "graph.json"),
    encodeJson(snapshot.graph),
  );
  await writeFileAtomic(
    path.join(packDir, "session.json"),
    encodeJson({
      placeId: sessionFile.placeId,
      lastTurnAt: sessionFile.lastTurnAt,
      modelId: sessionFile.modelId,
    }),
  );
  await writeHeadFile(packDir, snapshot.revision, snapshot.createdAt);
}

/**
 * zh: 把区域与对象版本写到 scene/ 下。
 * en: Write region and object versions under scene/.
 */
async function writeSceneSidecars(
  packDir: string,
  snapshot: WorldSnapshot,
): Promise<void> {
  for (const region of snapshot.regions) {
    const posixPath = `scene/regions/${region.regionId}/${snapshot.revision}.json`;
    await writeFileAtomic(resolvePosix(packDir, posixPath), encodeJson(region));
  }
  for (const object of snapshot.objects) {
    const posixPath = `scene/objects/${object.sceneObjectId}/${snapshot.revision}.json`;
    await writeFileAtomic(resolvePosix(packDir, posixPath), encodeJson(object));
  }
}

/**
 * zh: 按快照资产清单把规则文档与 session.json 还原到工作区。
 * en: Restore rule documents and session.json into the working tree from the snapshot manifest.
 */
async function restoreLogicalFilesFromManifest(
  packDir: string,
  snapshot: WorldSnapshot,
): Promise<void> {
  await writeFileAtomic(
    path.join(packDir, "graph.json"),
    encodeJson(snapshot.graph),
  );
  for (const entry of snapshot.assetManifest) {
    if (!LOGICAL_FILE_SET.has(entry.posixPath)) {
      continue;
    }
    const ext = extensionOfLogicalPath(entry.posixPath);
    const assetPath = resolvePosix(packDir, `assets/${entry.hash}.${ext}`);
    let bytes: Buffer;
    try {
      bytes = await readFile(assetPath);
    } catch (error) {
      if (isNodeErrno(error, "ENOENT")) {
        throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
      }
      throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
    }
    await writeFileAtomic(resolvePosix(packDir, entry.posixPath), bytes);
  }
}

/**
 * zh: 去掉值为 undefined 的可选 session 字段。
 * en: Omit optional session fields whose value is undefined.
 */
function stripUndefinedSessionFields(
  session: WorldSnapshot["session"],
): WorldSnapshot["session"] {
  if (session.thumbnailPosix !== undefined) {
    return session;
  }
  const { thumbnailPosix: _omitted, ...rest } = session;
  return rest;
}

/**
 * zh: 从文档记录生成提交 ruleHashes。
 * en: Build commit ruleHashes from document records.
 */
function ruleHashesFromDocs(
  documents: Record<string, { body: string; hash: string }>,
): Record<string, string> {
  const ruleHashes: Record<string, string> = {};
  for (const documentId of WORLD_DOCUMENT_FILES) {
    const doc = documents[documentId];
    if (doc === undefined) {
      continue;
    }
    ruleHashes[documentId] = doc.hash;
  }
  return ruleHashes;
}

/**
 * zh: 是否为本世界规则文件名。
 * en: Whether the id is a world rule file name.
 */
function isWorldDocumentFile(
  documentId: string,
): documentId is WorldDocumentFile {
  return (WORLD_DOCUMENT_FILES as readonly string[]).includes(documentId);
}

/**
 * zh: 逻辑路径的扩展名。
 * en: File extension of a logical pack path.
 */
function extensionOfLogicalPath(posixPath: string): string {
  const dot = posixPath.lastIndexOf(".");
  if (dot === -1 || dot === posixPath.length - 1) {
    return "bin";
  }
  return normalizeAssetExt(posixPath.slice(dot + 1));
}
