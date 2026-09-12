import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CarinaError } from "../errors.js";
import {
  commitRecordSchema,
  graphFileSchema,
  headFileSchema,
  NodeType,
  sessionFileSchema,
  WORLD_DOCUMENT_IDS,
  worldSnapshotSchema,
  type CommitRecord,
  type GraphFile,
  type SessionFile,
  type WorldSnapshot,
  type WorldSessionRecord,
} from "../schema/index.js";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";
import { sha256Hex } from "./hash.js";
import { encodeJson, writeFileAtomic } from "./open.js";
import { resolvePosix } from "./paths.js";
import { isNodeErrno } from "./sandbox.js";

/**
 * zh: 包内本世界规则文件名。
 * en: Pack-relative world rule file names.
 */
export const WORLD_DOCUMENT_FILES = [
  WORLD_DOCUMENT_IDS.world,
  WORLD_DOCUMENT_IDS.player,
  WORLD_DOCUMENT_IDS.steward,
  WORLD_DOCUMENT_IDS.memory,
] as const;

export type WorldDocumentFile = (typeof WORLD_DOCUMENT_FILES)[number];

/**
 * zh: 工作区投影文件，随 revision 内容寻址。
 * en: Working-tree projection files, content-addressed per revision.
 */
export const LOGICAL_PROJECTION_FILES = [
  ...WORLD_DOCUMENT_FILES,
  "session.json",
] as const;

/**
 * zh: 首版默认自动任务预算。
 * en: Default automatic-job budget for v1 worlds.
 */
export const DEFAULT_BUDGET_POLICY = {
  maxAutoJobs: 2,
  maxRepairAttempts: 2,
  maxRunSeconds: 3600,
} as const;

/**
 * zh: 迁移时尚未绑定全局档案。
 * en: Sentinel used when a pack is migrated before a global profile exists.
 */
export const UNBOUND_GLOBAL_PROFILE_REF = "unbound";

/**
 * zh: v1 包目录。createPack 与 v0 迁移都要建齐。
 * en: v1 pack directories. createPack and v0 migration both create these.
 */
export const V1_PACK_DIRECTORIES = [
  "commits",
  "snapshots",
  "assets",
  "scene/regions",
  "scene/objects",
  "checkpoints",
  "observations",
  "dialogue",
  "jobs",
] as const;

/**
 * zh: 把文本规范成 LF。
 * en: Normalize text to LF newlines.
 */
export function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * zh: 建齐 v1 目录；已存在则忽略。
 * en: Create v1 directories; ignore those that already exist.
 */
export async function ensureV1Directories(packDir: string): Promise<void> {
  for (const posixDir of V1_PACK_DIRECTORIES) {
    await mkdir(path.join(packDir, ...posixDir.split("/")), {
      recursive: true,
    });
  }
}

/**
 * zh: 按 sha256 写入 assets/<hash>.<ext>；已有同名文件则跳过。
 * en: Write assets/<hash>.<ext> by sha256; skip if that file already exists.
 */
export async function writeContentAddressedAsset(
  packDir: string,
  bytes: string | Uint8Array,
  ext: string,
): Promise<{ hash: string; posixPath: string }> {
  const safeExt = normalizeAssetExt(ext);
  const hash = sha256Hex(bytes);
  const posixPath = `assets/${hash}.${safeExt}`;
  const absPath = resolvePosix(packDir, posixPath);
  try {
    await access(absPath);
    return { hash, posixPath };
  } catch (error) {
    if (!isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
    }
  }
  try {
    await writeFileAtomic(absPath, bytes);
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
  return { hash, posixPath };
}

/**
 * zh: HEAD.json 是否已存在。
 * en: Whether HEAD.json already exists.
 */
export async function headFileExists(packDir: string): Promise<boolean> {
  try {
    await access(path.join(packDir, "HEAD.json"));
    return true;
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      return false;
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
}

/**
 * zh: 从当前 graph/session/Markdown 写第一份 revision。不伪造事件历史，不改写 graph.json。
 * en: Create the first revision from current graph/session/markdown. Do not fake event history or rewrite graph.json.
 */
export async function migrateV0ToV1(packDir: string): Promise<void> {
  await ensureV1Directories(packDir);
  const graph = await readGraphProjection(packDir);
  const sessionFile = await readSessionProjection(packDir);
  const documents = await readWorldDocumentBodies(packDir);
  const worldDoc = documents[WORLD_DOCUMENT_IDS.world];
  if (worldDoc === undefined) {
    throw new CarinaError("PACK_INVALID", "error.packInvalid");
  }
  const revision = createUlid();
  const createdAt = nowIsoUtc();
  const worldId = worldIdFromGraph(graph);
  const name = worldNameFromGraph(graph, packDir);
  const ruleHashes = hashesFromDocuments(documents);
  const worldRules = compileWorldRules(worldDoc.body, revision, worldDoc.hash);
  const assetManifest = await stageLogicalProjections(
    packDir,
    documents,
    sessionFile,
  );
  const session = buildInitialSessionRecord({
    worldId,
    name,
    revision,
    createdAt,
    ruleDocumentRefs: ruleHashes,
  });
  const snapshot = worldSnapshotSchema.parse({
    revision,
    parentRevision: null,
    worldId,
    createdAt,
    session,
    graph,
    worldRules,
    regions: [],
    objects: [],
    simTime: 0,
    controlEpoch: 0,
    assetManifest,
  });
  const commit = commitRecordSchema.parse({
    revision,
    parentRevision: null,
    worldId,
    commandId: createUlid(),
    createdAt,
    snapshotPosix: snapshotPosix(revision),
    ruleHashes,
    summary:
      "v1 baseline from graph and session; no reconstructed event history",
  });
  await writeSnapshotFile(packDir, snapshot);
  await writeCommitFile(packDir, commit);
  await writeHeadFile(packDir, revision, createdAt);
}

/**
 * zh: 读取包内四份世界规则正文与哈希。
 * en: Read the four world-rule bodies and hashes from the pack.
 */
export async function readWorldDocumentBodies(
  packDir: string,
): Promise<Record<string, { body: string; hash: string }>> {
  const documents: Record<string, { body: string; hash: string }> = {};
  for (const documentId of WORLD_DOCUMENT_FILES) {
    const body = await readUtf8PackFile(packDir, documentId);
    documents[documentId] = { body, hash: sha256Hex(body) };
  }
  return documents;
}

/**
 * zh: 把工作区 Markdown 与 session.json 内容寻址进 assets/。
 * en: Content-address working-tree markdown and session.json into assets/.
 */
export async function stageLogicalProjections(
  packDir: string,
  documents: Record<string, { body: string; hash: string }>,
  sessionFile: SessionFile,
): Promise<Array<{ posixPath: string; hash: string }>> {
  const manifest: Array<{ posixPath: string; hash: string }> = [];
  for (const documentId of WORLD_DOCUMENT_FILES) {
    const doc = documents[documentId];
    if (doc === undefined) {
      continue;
    }
    await writeContentAddressedAsset(packDir, doc.body, "md");
    manifest.push({ posixPath: documentId, hash: doc.hash });
  }
  const sessionBody = encodeJson(sessionFile);
  const sessionAsset = await writeContentAddressedAsset(
    packDir,
    sessionBody,
    "json",
  );
  manifest.push({ posixPath: "session.json", hash: sessionAsset.hash });
  return manifest;
}

/**
 * zh: 读取 graph.json 投影。
 * en: Read the graph.json projection.
 */
export async function readGraphProjection(packDir: string): Promise<GraphFile> {
  const text = await readUtf8PackFile(packDir, "graph.json");
  const parsedJson = parseJson(text, "GRAPH_INVALID", "error.graphInvalid");
  const parsed = graphFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new CarinaError("GRAPH_INVALID", "error.graphInvalid", parsed.error);
  }
  return parsed.data;
}

/**
 * zh: 读取 session.json 投影。
 * en: Read the session.json projection.
 */
export async function readSessionProjection(
  packDir: string,
): Promise<SessionFile> {
  const text = await readUtf8PackFile(packDir, "session.json");
  const parsedJson = parseJson(text, "SESSION_INVALID", "error.sessionInvalid");
  const parsed = sessionFileSchema.safeParse(parsedJson);
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
 * zh: 原子写入 snapshots/<revision>.json。
 * en: Atomically write snapshots/<revision>.json.
 */
export async function writeSnapshotFile(
  packDir: string,
  snapshot: WorldSnapshot,
): Promise<void> {
  const parsed = worldSnapshotSchema.parse(snapshot);
  await writeFileAtomic(
    resolvePosix(packDir, snapshotPosix(parsed.revision)),
    encodeJson(parsed),
  );
}

/**
 * zh: 原子写入 commits/<revision>.json。
 * en: Atomically write commits/<revision>.json.
 */
export async function writeCommitFile(
  packDir: string,
  commit: CommitRecord,
): Promise<void> {
  const parsed = commitRecordSchema.parse(commit);
  await writeFileAtomic(
    resolvePosix(packDir, commitPosix(parsed.revision)),
    encodeJson(parsed),
  );
}

/**
 * zh: 原子写入 HEAD.json。应在资产与提交记录之后调用。
 * en: Atomically write HEAD.json. Call after assets and commit records.
 */
export async function writeHeadFile(
  packDir: string,
  revision: string,
  updatedAt: string,
): Promise<void> {
  const parsed = headFileSchema.parse({ revision, updatedAt });
  await writeFileAtomic(path.join(packDir, "HEAD.json"), encodeJson(parsed));
}

/**
 * zh: 快照的包内 POSIX 路径。
 * en: Pack-relative POSIX path of a snapshot file.
 */
export function snapshotPosix(revision: string): string {
  return `snapshots/${revision}.json`;
}

/**
 * zh: 提交记录的包内 POSIX 路径。
 * en: Pack-relative POSIX path of a commit record.
 */
export function commitPosix(revision: string): string {
  return `commits/${revision}.json`;
}

/**
 * zh: 从图谱 World 节点取 worldId；没有则新建 ULID。
 * en: Read worldId from the graph World node; otherwise create a ULID.
 */
export function worldIdFromGraph(graph: GraphFile): string {
  const worldNode = graph.nodes.find((node) => node.type === NodeType.World);
  if (worldNode !== undefined) {
    return worldNode.id;
  }
  return createUlid();
}

/**
 * zh: 规范化资产扩展名，拒绝路径分隔符。
 * en: Normalize an asset extension and reject path separators.
 */
export function normalizeAssetExt(ext: string): string {
  const trimmed = ext.startsWith(".") ? ext.slice(1) : ext;
  if (
    trimmed.length === 0 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.includes("..")
  ) {
    throw new CarinaError("SANDBOX", "error.sandbox");
  }
  return trimmed;
}

/**
 * zh: 从哈希表抽出规则文件哈希。
 * en: Build ruleHashes from document records.
 */
function hashesFromDocuments(
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
 * zh: 组装迁移用的 WorldSession 记录。
 * en: Build the initial WorldSession record used by migration.
 */
function buildInitialSessionRecord(input: {
  worldId: string;
  name: string;
  revision: string;
  createdAt: string;
  ruleDocumentRefs: Record<string, string>;
}): WorldSessionRecord {
  return {
    sessionId: input.worldId,
    name: input.name,
    schemaVersion: 1,
    lifecycle: "active",
    runState: "paused",
    headRevision: input.revision,
    controlEpoch: 0,
    simTime: 0,
    playerStateRef: "player",
    worldRulesRef: WORLD_DOCUMENT_IDS.world,
    ruleDocumentRefs: input.ruleDocumentRefs,
    globalProfileRef: UNBOUND_GLOBAL_PROFILE_REF,
    activeRegionId: null,
    budgetPolicy: {
      maxAutoJobs: DEFAULT_BUDGET_POLICY.maxAutoJobs,
      maxRepairAttempts: DEFAULT_BUDGET_POLICY.maxRepairAttempts,
      maxRunSeconds: DEFAULT_BUDGET_POLICY.maxRunSeconds,
    },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

/**
 * zh: 世界名取自 World 节点或目录名。
 * en: World name from the World node or the directory name.
 */
function worldNameFromGraph(graph: GraphFile, packDir: string): string {
  const worldNode = graph.nodes.find((node) => node.type === NodeType.World);
  const named = worldNode?.props["name"];
  if (typeof named === "string" && named.length > 0) {
    return named;
  }
  const baseName = path.basename(packDir);
  const suffix = ".carina";
  if (baseName.endsWith(suffix) && baseName.length > suffix.length) {
    return baseName.slice(0, -suffix.length);
  }
  return baseName.length > 0 ? baseName : "World";
}

/**
 * zh: 读包内 UTF-8 文件并规范成 LF。
 * en: Read a pack UTF-8 file and normalize to LF.
 */
async function readUtf8PackFile(
  packDir: string,
  posixPath: string,
): Promise<string> {
  const absPath =
    posixPath === "graph.json" || posixPath === "session.json"
      ? path.join(packDir, posixPath)
      : resolvePosix(packDir, posixPath);
  try {
    const text = await readFile(absPath, "utf8");
    return normalizeLf(text);
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      if (posixPath === "session.json") {
        throw new CarinaError("SESSION_INVALID", "error.sessionInvalid", error);
      }
      if (posixPath === "graph.json") {
        throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
      }
      throw new CarinaError("NOT_FOUND", "error.notFound", error);
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
}

/**
 * zh: JSON.parse，失败则抛 CarinaError。
 * en: JSON.parse, throwing CarinaError on failure.
 */
function parseJson(
  text: string,
  code: "GRAPH_INVALID" | "SESSION_INVALID" | "PACK_INVALID",
  messageKey:
    "error.graphInvalid" | "error.sessionInvalid" | "error.packInvalid",
): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CarinaError(code, messageKey, error);
  }
}
