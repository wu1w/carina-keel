import { readFile } from "node:fs/promises";
import {
  listSkills,
  readMarkdown,
  resolvePosix,
  type PackHandle,
} from "../pack/index.js";
import { chronicleEventSchema, type ChronicleEvent } from "../schema/index.js";
import type { WorldStore } from "../world/index.js";
import { CarinaError } from "../errors.js";
import { DEFAULT_HOP_COUNT, DEFAULT_MAX_CHAT_TURNS } from "./constants.js";
import {
  assembleSlices,
  type AssembleSlicesOptions,
} from "./assemble-slices.js";
import {
  asSubgraph,
  formatChatTurns,
  formatChronicle,
  formatPresence,
} from "./format-context.js";
import {
  parseSkillName,
  skillNameFromPosix,
  type SkillDocument,
} from "./inject-skills.js";

/**
 * zh: 世界包句柄（与 pack.openPack 相同）。
 * en: Pack handle (same as pack.openPack).
 */
export type StewardPackHandle = PackHandle;

/**
 * zh: assembleContext 的可选预算与时钟。
 * en: Optional budgets and clock for assembleContext.
 */
export type AssembleContextOptions = AssembleSlicesOptions & {
  /**
   * zh: 现场邻域跳数，默认 2。
   * en: Neighborhood hop count, default 2.
   */
  hopCount?: number;
  /**
   * zh: 用于今昨编年的时钟。
   * en: Clock used to pick today and yesterday chronicle files.
   */
  now?: Date;
};

/**
 * zh: 按第 10 节顺序组装管家系统上下文：宪法、技能、玩家、记忆、现场、今昨编年、最近对话。
 * en: Assemble steward system context in §10 order: constitution, skills, player, memory, presence, today/yesterday chronicle, recent chat.
 */
export async function assembleContext(
  store: WorldStore,
  pack: PackHandle,
  opts: AssembleContextOptions = {},
): Promise<string> {
  const hopCount = opts.hopCount ?? DEFAULT_HOP_COUNT;
  const maxChatTurns = opts.maxChatTurns ?? DEFAULT_MAX_CHAT_TURNS;
  const now = opts.now ?? new Date();

  const steward = await readPackMarkdown(pack, "STEWARD.md");
  const world = await readPackMarkdown(pack, "WORLD.md");
  const player = await readPackMarkdown(pack, "PLAYER.md");
  const memory = await readPackMarkdown(pack, "MEMORY.md");
  const skills = await loadSkillDocuments(pack);

  const placeId = pack.session.placeId;
  const placeNode =
    placeId === null
      ? undefined
      : pack.graph.nodes.find((node) => node.id === placeId);
  const neighborhood = await loadNeighborhood(store, placeId, hopCount);
  const presence = formatPresence(placeId, placeNode, neighborhood);

  const chronicleEvents = await loadTodayAndYesterday(pack, now);
  const events = formatChronicle(chronicleEvents);
  const chat = formatChatTurns(chronicleEvents, maxChatTurns);

  return assembleSlices(
    {
      steward,
      world,
      skills,
      player,
      memory,
      presence,
      events,
      chat,
    },
    opts,
  );
}

/**
 * zh: 读取包内 Markdown；缺失则空字符串。
 * en: Read pack Markdown; missing files become an empty string.
 */
async function readPackMarkdown(
  pack: PackHandle,
  filename: string,
): Promise<string> {
  try {
    const text = await Promise.resolve(readMarkdown(pack, filename));
    return typeof text === "string" ? text : "";
  } catch (error) {
    if (isEnoent(error) || isPackMissing(error) || isSandbox(error)) {
      return "";
    }
    throw error;
  }
}

/**
 * zh: 读 UTF-8 文件；不存在则空字符串。
 * en: Read a UTF-8 file; missing files become an empty string.
 */
async function readFileUtf8(absPath: string): Promise<string> {
  try {
    return await readFile(absPath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return "";
    }
    throw error;
  }
}

/**
 * zh: 经 listSkills 载入技能正文。
 * en: Load skill bodies via listSkills.
 */
async function loadSkillDocuments(
  pack: PackHandle,
): Promise<SkillDocument[]> {
  const listed = await Promise.resolve(listSkills(pack));
  if (!Array.isArray(listed)) {
    return [];
  }
  const documents: SkillDocument[] = [];
  for (const item of listed) {
    const source = normalizeListedSkill(item);
    if (source === undefined) {
      continue;
    }
    let body = source.body;
    if (body === undefined) {
      body = await readPackMarkdown(pack, source.posixPath);
      if (body.length === 0) {
        body = await readFileUtf8(
          resolvePosix(pack.packDir, source.posixPath),
        );
      }
    }
    if (body.trim().length === 0) {
      continue;
    }
    const name = parseSkillName(body, source.name);
    documents.push({ name, posixPath: source.posixPath, body });
  }
  return documents;
}

/**
 * zh: 把 listSkills 的一项收成路径与可选正文。
 * en: Normalize one listSkills entry into a path and optional body.
 */
function normalizeListedSkill(
  item: unknown,
): { name: string; posixPath: string; body?: string } | undefined {
  if (typeof item === "string") {
    return { name: skillNameFromPosix(item), posixPath: item };
  }
  if (!isRecord(item)) {
    return undefined;
  }
  const posixPath =
    typeof item["posixPath"] === "string"
      ? item["posixPath"]
      : typeof item["path"] === "string"
        ? item["path"]
        : undefined;
  if (posixPath === undefined) {
    return undefined;
  }
  const name =
    typeof item["name"] === "string"
      ? item["name"]
      : skillNameFromPosix(posixPath);
  const body =
    typeof item["body"] === "string"
      ? item["body"]
      : typeof item["content"] === "string"
        ? item["content"]
        : undefined;
  if (body === undefined) {
    return { name, posixPath };
  }
  return { name, posixPath, body };
}

/**
 * zh: 读取当前地点的 N 跳子图；地点不存在则空图。
 * en: Load the N-hop subgraph for the current place; empty if the place is missing.
 */
async function loadNeighborhood(
  store: WorldStore,
  placeId: string | null,
  hopCount: number,
) {
  if (placeId === null) {
    return asSubgraph(undefined);
  }
  try {
    const raw = await Promise.resolve(store.hopNeighborhood(placeId, hopCount));
    return asSubgraph(raw);
  } catch (error) {
    if (error instanceof CarinaError && error.code === "NOT_FOUND") {
      return asSubgraph(undefined);
    }
    throw error;
  }
}

/**
 * zh: 读取 UTC 今天与昨天的 events/*.jsonl。
 * en: Load UTC today and yesterday events/*.jsonl files.
 */
async function loadTodayAndYesterday(
  pack: PackHandle,
  now: Date,
): Promise<ChronicleEvent[]> {
  const today = utcDayStamp(now);
  const yesterday = utcDayStamp(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const yesterdayEvents = await readChronicleFile(
    resolvePosix(pack.packDir, `events/${yesterday}.jsonl`),
  );
  const todayEvents = await readChronicleFile(
    resolvePosix(pack.packDir, `events/${today}.jsonl`),
  );
  return [...yesterdayEvents, ...todayEvents];
}

/**
 * zh: 解析一份 jsonl 编年；文件不存在则空数组。
 * en: Parse one jsonl chronicle file; missing file yields an empty array.
 */
async function readChronicleFile(absPath: string): Promise<ChronicleEvent[]> {
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
  return parseChronicleLines(raw);
}

/**
 * zh: 按行解析编年；非法 JSON 抛 GRAPH_INVALID。
 * en: Parse chronicle lines; invalid JSON throws GRAPH_INVALID.
 */
function parseChronicleLines(raw: string): ChronicleEvent[] {
  const events: ChronicleEvent[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (cause) {
      throw new CarinaError("GRAPH_INVALID", "error.graphInvalid", cause);
    }
    const parsedEvent = chronicleEventSchema.safeParse(parsed);
    if (!parsedEvent.success) {
      throw new CarinaError(
        "GRAPH_INVALID",
        "error.graphInvalid",
        parsedEvent.error,
      );
    }
    events.push(parsedEvent.data);
  }
  return events;
}

/**
 * zh: UTC 日期戳 YYYY-MM-DD。
 * en: UTC calendar stamp YYYY-MM-DD.
 */
function utcDayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * zh: 是否为文件不存在。
 * en: Whether the error is a missing file.
 */
function isEnoent(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (!("code" in error)) {
    return false;
  }
  return error.code === "ENOENT";
}

/**
 * zh: 是否为包内文件缺失类错误。
 * en: Whether the error is a missing pack-file error.
 */
function isPackMissing(error: unknown): boolean {
  return (
    error instanceof CarinaError &&
    (error.code === "PACK_NOT_FOUND" || error.code === "NOT_FOUND")
  );
}

/**
 * zh: 是否为路径沙箱错误。
 * en: Whether the error is a sandbox path error.
 */
function isSandbox(error: unknown): boolean {
  return error instanceof CarinaError && error.code === "SANDBOX";
}

/**
 * zh: 普通对象守卫。
 * en: Guard for a plain object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
