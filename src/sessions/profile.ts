import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CarinaError } from "../errors.js";
import { sha256Hex } from "../pack/hash.js";
import { encodeJson, writeFileAtomic } from "../pack/open.js";
import {
  GLOBAL_DOCUMENT_IDS,
  globalProfileSchema,
  type GlobalProfile,
} from "../schema/index.js";
import { isEnoent, nowIsoUtc } from "../world/ids.js";
import { withDataDirLock } from "./registry.js";

const GLOBAL_DOCUMENT_FILES = [
  GLOBAL_DOCUMENT_IDS.identity,
  GLOBAL_DOCUMENT_IDS.agent,
  GLOBAL_DOCUMENT_IDS.global,
] as const;

export type GlobalDocumentId = (typeof GLOBAL_DOCUMENT_FILES)[number];

/**
 * zh: 读取全局档案。首次把模板拷进 dataDir/profile。
 * en: Read the global profile. First read copies templates into dataDir/profile.
 */
export async function readGlobalProfile(
  dataDir: string,
  lang: "zh" | "en",
): Promise<{ profile: GlobalProfile; documents: Record<string, string> }> {
  return withDataDirLock(dataDir, () =>
    readGlobalProfileUnlocked(dataDir, lang),
  );
}

/**
 * zh: 更新一份全局文档。expectedHash 不匹配则拒绝。不改写世界包。
 * en: Update one global document. Reject on expectedHash mismatch. Does not rewrite world packs.
 */
export async function updateGlobalDocument(
  dataDir: string,
  documentId: "IDENTITY.md" | "AGENT.md" | "GLOBAL.md",
  body: string,
  expectedHash?: string,
): Promise<GlobalProfile> {
  return withDataDirLock(dataDir, () =>
    updateGlobalDocumentUnlocked(dataDir, documentId, body, expectedHash),
  );
}

/**
 * zh: 已持 dataDir 锁时读取全局档案。
 * en: Read the global profile while the dataDir lock is held.
 */
export async function readGlobalProfileUnlocked(
  dataDir: string,
  lang: "zh" | "en",
): Promise<{ profile: GlobalProfile; documents: Record<string, string> }> {
  const profileDir = profileDirectory(dataDir);
  await mkdir(profileDir, { recursive: true });
  await seedMissingProfileDocuments(profileDir, lang);
  const documents: Record<string, string> = {};
  for (const documentId of GLOBAL_DOCUMENT_FILES) {
    documents[documentId] = await readProfileDocument(profileDir, documentId);
  }
  const profile = await writeProfileJson(profileDir, documents);
  return { profile, documents };
}

/**
 * zh: 已持锁时更新全局文档。
 * en: Update a global document while the dataDir lock is held.
 */
export async function updateGlobalDocumentUnlocked(
  dataDir: string,
  documentId: "IDENTITY.md" | "AGENT.md" | "GLOBAL.md",
  body: string,
  expectedHash?: string,
): Promise<GlobalProfile> {
  if (!isGlobalDocumentId(documentId)) {
    throw new CarinaError("RULES_INVALID", "error.rulesInvalid");
  }
  const profileDir = profileDirectory(dataDir);
  await mkdir(profileDir, { recursive: true });
  const currentPath = path.join(profileDir, documentId);
  let currentBody: string | undefined;
  try {
    currentBody = normalizeLf(await readFile(currentPath, "utf8"));
  } catch (error) {
    if (!isEnoent(error)) {
      throw new CarinaError("RULES_INVALID", "error.rulesInvalid", error);
    }
  }
  if (expectedHash !== undefined) {
    const currentHash =
      currentBody === undefined ? undefined : sha256Hex(currentBody);
    if (currentHash !== expectedHash) {
      throw new CarinaError("RULES_INVALID", "error.rulesInvalid");
    }
  }
  const lfBody = normalizeLf(body);
  await writeFileAtomic(currentPath, lfBody);
  const { profile } = await readGlobalProfileUnlocked(dataDir, "zh");
  return profile;
}

/**
 * zh: 把三份全局文档哈希收成世界可引用的档案指针。
 * en: Fold the three global document hashes into a world-facing profile pointer.
 */
export function globalProfileRefHash(profile: GlobalProfile): string {
  return sha256Hex(
    `${profile.identityHash}:${profile.agentHash}:${profile.globalRulesHash}`,
  );
}

/**
 * zh: 全局档案目录。
 * en: Global profile directory.
 */
function profileDirectory(dataDir: string): string {
  return path.join(path.resolve(dataDir), "profile");
}

/**
 * zh: 缺文件时从语言模板拷贝，不覆盖已有正文。
 * en: Copy language templates for missing files; do not overwrite existing bodies.
 */
async function seedMissingProfileDocuments(
  profileDir: string,
  lang: "zh" | "en",
): Promise<void> {
  const templatesDir = await resolveProfileTemplatesDir(lang);
  for (const documentId of GLOBAL_DOCUMENT_FILES) {
    const destPath = path.join(profileDir, documentId);
    try {
      await access(destPath);
      continue;
    } catch (error) {
      if (!isEnoent(error)) {
        throw new CarinaError("INTERNAL", "error.internal", error);
      }
    }
    let text: string;
    try {
      text = await readFile(path.join(templatesDir, documentId), "utf8");
    } catch (error) {
      throw new CarinaError("INTERNAL", "error.internal", error);
    }
    await writeFileAtomic(destPath, normalizeLf(text));
  }
}

/**
 * zh: 解析全局档案模板目录。tsx 用 src；编译后用 dist 拷贝或源树。
 * en: Resolve the global profile template directory. tsx uses src; after tsc, dist copy or source tree.
 */
async function resolveProfileTemplatesDir(lang: "zh" | "en"): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "i18n", "templates", "profile", lang),
    path.join(here, "..", "..", "src", "i18n", "templates", "profile", lang),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, GLOBAL_DOCUMENT_IDS.identity));
      return candidate;
    } catch {
      continue;
    }
  }
  throw new CarinaError("INTERNAL", "error.internal");
}

/**
 * zh: 读一份全局 Markdown。
 * en: Read one global markdown document.
 */
async function readProfileDocument(
  profileDir: string,
  documentId: GlobalDocumentId,
): Promise<string> {
  try {
    return normalizeLf(
      await readFile(path.join(profileDir, documentId), "utf8"),
    );
  } catch (error) {
    throw new CarinaError("RULES_INVALID", "error.rulesInvalid", error);
  }
}

/**
 * zh: 按当前正文重写 profile.json。
 * en: Rewrite profile.json from current document bodies.
 */
async function writeProfileJson(
  profileDir: string,
  documents: Record<string, string>,
): Promise<GlobalProfile> {
  const identity = documents[GLOBAL_DOCUMENT_IDS.identity];
  const agent = documents[GLOBAL_DOCUMENT_IDS.agent];
  const globalRules = documents[GLOBAL_DOCUMENT_IDS.global];
  if (
    identity === undefined ||
    agent === undefined ||
    globalRules === undefined
  ) {
    throw new CarinaError("RULES_INVALID", "error.rulesInvalid");
  }
  const profile = globalProfileSchema.parse({
    schemaVersion: 1,
    identityHash: sha256Hex(identity),
    agentHash: sha256Hex(agent),
    globalRulesHash: sha256Hex(globalRules),
    updatedAt: nowIsoUtc(),
  });
  await writeFileAtomic(
    path.join(profileDir, "profile.json"),
    encodeJson(profile),
  );
  return profile;
}

/**
 * zh: 把文本规范成 LF。
 * en: Normalize text to LF newlines.
 */
function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * zh: 是否为全局文档 id。
 * en: Whether the id is a global document id.
 */
function isGlobalDocumentId(
  documentId: string,
): documentId is GlobalDocumentId {
  return (GLOBAL_DOCUMENT_FILES as readonly string[]).includes(documentId);
}
