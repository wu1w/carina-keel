import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ulid } from "ulid";
import { CarinaError } from "../errors.js";
import { NodeType, type GraphFile, type SessionFile } from "../schema/index.js";
import { encodeJson } from "./open.js";
import { isNodeErrno } from "./sandbox.js";

const MARKDOWN_FILES = [
  "WORLD.md",
  "PLAYER.md",
  "STEWARD.md",
  "MEMORY.md",
] as const;

const EXAMPLE_SKILL_POSIX = "skills/tavern-continuity/SKILL.md";

/**
 * zh: 按语言创建世界包目录、模板、graph.json 与空编年。
 * en: Create a world pack directory, templates, graph.json, and an empty chronicle.
 */
export async function createPack(
  packDir: string,
  lang: "zh" | "en",
): Promise<void> {
  if (lang !== "zh" && lang !== "en") {
    throw new CarinaError("CONFIG", "error.config");
  }
  const resolvedDir = path.resolve(packDir);
  await assertPackCanBeCreated(resolvedDir);
  try {
    await mkdir(path.join(resolvedDir, "events"), { recursive: true });
    await mkdir(path.join(resolvedDir, "assets"), { recursive: true });
    await mkdir(path.join(resolvedDir, "skills"), { recursive: true });
    await copyTemplates(resolvedDir, lang);
    const createdAt = new Date().toISOString();
    const graph: GraphFile = {
      version: 0,
      nodes: [
        {
          id: ulid(),
          type: NodeType.World,
          props: { name: worldNameFromPackDir(resolvedDir) },
          createdAt,
        },
      ],
      edges: [],
    };
    const session: SessionFile = {
      placeId: null,
      lastTurnAt: null,
      modelId: null,
    };
    await writeFile(
      path.join(resolvedDir, "graph.json"),
      encodeJson(graph),
      "utf8",
    );
    await writeFile(
      path.join(resolvedDir, "session.json"),
      encodeJson(session),
      "utf8",
    );
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("INTERNAL", "error.internal", error);
  }
}

/**
 * zh: 已有 graph.json 的路径不可再创建。
 * en: Refuse to create over a path that already has graph.json.
 */
async function assertPackCanBeCreated(packDir: string): Promise<void> {
  try {
    await access(path.join(packDir, "graph.json"));
    throw new CarinaError("PACK_INVALID", "error.packInvalid");
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    if (!isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
    }
  }
}

/**
 * zh: 世界名取自目录名，去掉 .carina 后缀。
 * en: World name comes from the folder name, minus a .carina suffix.
 */
function worldNameFromPackDir(packDir: string): string {
  const baseName = path.basename(packDir);
  const suffix = ".carina";
  if (baseName.endsWith(suffix) && baseName.length > suffix.length) {
    return baseName.slice(0, -suffix.length);
  }
  return baseName.length > 0 ? baseName : "World";
}

/**
 * zh: 解析语言模板目录。tsx 用 src；编译后用 dist 拷贝或源树。
 * en: Resolve the language template directory. tsx uses src; after tsc, dist copy or source tree.
 */
async function resolveTemplatesDir(lang: "zh" | "en"): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "i18n", "templates", lang),
    path.join(here, "..", "..", "src", "i18n", "templates", lang),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "WORLD.md"));
      return candidate;
    } catch {
      continue;
    }
  }
  throw new CarinaError("INTERNAL", "error.internal");
}

/**
 * zh: 从本仓 i18n 模板拷贝 Markdown（UTF-8、LF）。tsx 走 src，tsc 走 dist 旁的拷贝或源树。
 * en: Copy Markdown from this repo's i18n templates (UTF-8, LF). tsx uses src; tsc uses the dist copy or the source tree.
 */
async function copyTemplates(
  packDir: string,
  lang: "zh" | "en",
): Promise<void> {
  const templatesDir = await resolveTemplatesDir(lang);
  for (const fileName of MARKDOWN_FILES) {
    await copyTemplateFile(
      path.join(templatesDir, fileName),
      path.join(packDir, fileName),
    );
  }
  await mkdir(path.join(packDir, "skills", "tavern-continuity"), {
    recursive: true,
  });
  await copyTemplateFile(
    path.join(templatesDir, ...EXAMPLE_SKILL_POSIX.split("/")),
    path.join(packDir, ...EXAMPLE_SKILL_POSIX.split("/")),
  );
}

/**
 * zh: 读模板并写成 LF 文本。
 * en: Read a template and write it as LF text.
 */
async function copyTemplateFile(
  fromPath: string,
  toPath: string,
): Promise<void> {
  let text: string;
  try {
    text = await readFile(fromPath, "utf8");
  } catch (error) {
    throw new CarinaError("INTERNAL", "error.internal", error);
  }
  const lfText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  await mkdir(path.dirname(toPath), { recursive: true });
  await writeFile(toPath, lfText, "utf8");
}
