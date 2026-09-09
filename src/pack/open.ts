import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import { CarinaError } from "../errors.js";
import {
  graphFileSchema,
  sessionFileSchema,
  type GraphFile,
  type SessionFile,
} from "../schema/index.js";
import { isNodeErrno } from "./sandbox.js";

/**
 * zh: 已打开的世界包：可变 graph/session，save 原子写回。
 * en: An opened world pack: mutable graph/session, save writes atomically.
 */
export type PackHandle = {
  packDir: string;
  graph: GraphFile;
  session: SessionFile;
  save: () => Promise<void>;
};

/**
 * zh: 把值编成 UTF-8 LF 的 JSON 文件文本。
 * en: Encode a value as UTF-8 LF JSON file text.
 */
export function encodeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * zh: 同目录临时文件再 rename，避免写到一半。
 * en: Write a sibling temp file then rename so readers never see a half write.
 */
export async function writeFileAtomic(
  filePath: string,
  contents: string | Uint8Array,
): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const fileName = path.basename(filePath);
  const tempFilePath = path.join(directory, `.${fileName}.${ulid()}.tmp`);
  try {
    if (typeof contents === "string") {
      await writeFile(tempFilePath, contents, "utf8");
    } else {
      await writeFile(tempFilePath, contents);
    }
    await renameOverwriting(tempFilePath, filePath);
  } catch (error) {
    await unlink(tempFilePath).catch(() => undefined);
    throw error;
  }
}

/**
 * zh: rename；若目标已存在（常见于 Windows）则先删再改。
 * en: rename; if the destination exists (common on Windows), unlink then retry.
 */
async function renameOverwriting(
  fromPath: string,
  toPath: string,
): Promise<void> {
  try {
    await rename(fromPath, toPath);
  } catch (error) {
    if (
      isNodeErrno(error, "EEXIST") ||
      isNodeErrno(error, "EPERM") ||
      isNodeErrno(error, "EACCES")
    ) {
      await unlink(toPath);
      await rename(fromPath, toPath);
      return;
    }
    throw error;
  }
}

/**
 * zh: 打开世界包并校验 graph.json 与 session.json。
 * en: Open a world pack and validate graph.json and session.json.
 */
export async function openPack(packDir: string): Promise<PackHandle> {
  const resolvedDir = path.resolve(packDir);
  await assertPackDirectory(resolvedDir);
  const graph = await readGraphFile(resolvedDir);
  const session = await readSessionFile(resolvedDir);
  const handle: PackHandle = {
    packDir: resolvedDir,
    graph,
    session,
    async save() {
      await savePack(handle);
    },
  };
  return handle;
}

/**
 * zh: 原子写回 graph.json 与 session.json。
 * en: Atomically write graph.json and session.json.
 */
async function savePack(handle: PackHandle): Promise<void> {
  const graphParsed = graphFileSchema.safeParse(handle.graph);
  if (!graphParsed.success) {
    throw new CarinaError(
      "GRAPH_INVALID",
      "error.graphInvalid",
      graphParsed.error,
    );
  }
  const sessionParsed = sessionFileSchema.safeParse(handle.session);
  if (!sessionParsed.success) {
    throw new CarinaError(
      "SESSION_INVALID",
      "error.sessionInvalid",
      sessionParsed.error,
    );
  }
  try {
    await writeFileAtomic(
      path.join(handle.packDir, "graph.json"),
      encodeJson(graphParsed.data),
    );
    await writeFileAtomic(
      path.join(handle.packDir, "session.json"),
      encodeJson(sessionParsed.data),
    );
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("INTERNAL", "error.internal", error);
  }
}

/**
 * zh: 包路径必须是已存在的目录。
 * en: The pack path must be an existing directory.
 */
async function assertPackDirectory(packDir: string): Promise<void> {
  try {
    const info = await stat(packDir);
    if (!info.isDirectory()) {
      throw new CarinaError("PACK_INVALID", "error.packInvalid");
    }
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    if (isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("PACK_NOT_FOUND", "error.packNotFound", error);
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
}

/**
 * zh: 读取并校验 graph.json。
 * en: Read and validate graph.json.
 */
async function readGraphFile(packDir: string): Promise<GraphFile> {
  const filePath = path.join(packDir, "graph.json");
  const text = await readUtf8File(
    filePath,
    "PACK_INVALID",
    "error.packInvalid",
  );
  const parsedJson = parseJson(text, "GRAPH_INVALID", "error.graphInvalid");
  const parsed = graphFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new CarinaError("GRAPH_INVALID", "error.graphInvalid", parsed.error);
  }
  return parsed.data;
}

/**
 * zh: 读取并校验 session.json。
 * en: Read and validate session.json.
 */
async function readSessionFile(packDir: string): Promise<SessionFile> {
  const filePath = path.join(packDir, "session.json");
  const text = await readUtf8File(
    filePath,
    "SESSION_INVALID",
    "error.sessionInvalid",
  );
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
 * zh: 读 UTF-8 文件；缺文件时抛指定错误码。
 * en: Read a UTF-8 file; missing files throw the given code.
 */
async function readUtf8File(
  filePath: string,
  missingCode: "PACK_INVALID" | "SESSION_INVALID",
  missingKey: "error.packInvalid" | "error.sessionInvalid",
): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      throw new CarinaError(missingCode, missingKey, error);
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
  code: "GRAPH_INVALID" | "SESSION_INVALID",
  messageKey: "error.graphInvalid" | "error.sessionInvalid",
): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CarinaError(code, messageKey, error);
  }
}
