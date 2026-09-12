import type { CarinaConfig } from "../config.js";
import type {
  CommandResult,
  ExportManifest,
  RuntimeSnapshot,
  WorldCommand,
  WorldEvent,
  WorldSessionRecord,
  WorldSnapshot,
} from "../schema/index.js";
import type { WorldObservation } from "../application/observe.js";
import type { CommittedMapView } from "../spatial/index.js";

/**
 * zh: 会话读视图。不含二进制资产。
 * en: Session read view. No binary assets.
 */
export type SessionView = {
  session: WorldSessionRecord;
  snapshot: WorldSnapshot;
  runtime: RuntimeSnapshot;
  worldDocuments: Record<string, { body: string; hash: string }>;
  globalDocuments: Record<string, string>;
  assetPlan?: unknown;
  factoryManifest?: unknown;
  expansionLog?: unknown;
};

/**
 * zh: 列表中的世界摘要。
 * en: World summary for the session list.
 */
export type SessionListItem = {
  worldId: string;
  name: string;
  runState: string;
  lifecycle: string;
  updatedAt: string;
};

/**
 * zh: 应用层门面。HTTP/CLI 只调这里。
 * en: Application command facade. HTTP/CLI call only this.
 */
export type Application = {
  dispatchCommand(command: WorldCommand): Promise<CommandResult>;
  interpretAndDispatch(
    text: string,
    origin: WorldCommand["origin"],
    worldId?: string,
    requestedBy?: string,
  ): Promise<CommandResult[] | CommandResult>;
  listSessions(): Promise<unknown>;
  getSessionView(worldId: string): Promise<SessionView>;
  subscribeEvents(
    worldId: string,
    lastEventId?: string,
  ):
    | AsyncIterable<WorldEvent>
    | Promise<AsyncIterable<WorldEvent>>;
  exportGlb(
    worldId: string,
  ): Promise<{ glb: Uint8Array; manifest: ExportManifest }>;
  exportPack(
    worldId: string,
  ): Promise<{ zip: Uint8Array; name: string; revision: string }>;
  getCommittedMap(worldId: string): Promise<CommittedMapView>;
  readPackAsset(
    worldId: string,
    hash: string,
    ext: string,
  ): Promise<{ bytes: Uint8Array; mime: string }>;
  stagePackAsset(
    worldId: string,
    bytes: Uint8Array,
    ext: string,
  ): Promise<{ hash: string; posixPath: string }>;
  close(): Promise<void>;
  getObservation?(worldId: string): WorldObservation | undefined;
  hydrateObservation?(worldId: string): Promise<WorldObservation | undefined>;
};

/**
 * zh: 动态加载 createApplication；模块缺失时返回 undefined。
 * en: Dynamically load createApplication; return undefined if the module is missing.
 */
export async function tryCreateApplication(
  config: CarinaConfig,
): Promise<Application | undefined> {
  try {
    const specifier = ["..", "application", "index.js"].join("/");
    const loaded: unknown = await import(specifier);
    if (typeof loaded !== "object" || loaded === null) {
      return undefined;
    }
    const create = (loaded as { createApplication?: unknown }).createApplication;
    if (typeof create !== "function") {
      return undefined;
    }
    return await (
      create as (input: CarinaConfig) => Promise<Application>
    )(config);
  } catch {
    return undefined;
  }
}

/**
 * zh: 把 listSessions 的各种形状收成 UI 列表。
 * en: Normalize whatever listSessions returns into a UI list.
 */
export function normalizeSessionList(raw: unknown): {
  worlds: SessionListItem[];
  activeWorldId: string | null;
} {
  let rows: unknown[] = [];
  let activeWorldId: string | null = null;
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (raw !== null && typeof raw === "object") {
    const record = raw as {
      worlds?: unknown;
      activeWorldId?: unknown;
    };
    if (Array.isArray(record.worlds)) {
      rows = record.worlds;
    }
    if (typeof record.activeWorldId === "string") {
      activeWorldId = record.activeWorldId;
    }
  }
  const worlds: SessionListItem[] = [];
  for (const row of rows) {
    const item = sessionListItem(row);
    if (item !== undefined) {
      worlds.push(item);
      if (activeWorldId === null && item.lifecycle === "active") {
        activeWorldId = item.worldId;
      }
    }
  }
  return { worlds, activeWorldId };
}

/**
 * zh: 从一行注册表/session 记录取出列表字段。
 * en: Pull list fields from one registry or session record.
 */
function sessionListItem(row: unknown): SessionListItem | undefined {
  if (row === null || typeof row !== "object") {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  const worldId =
    stringField(record, "worldId") ?? stringField(record, "sessionId");
  const name = stringField(record, "name");
  if (worldId === undefined || name === undefined) {
    return undefined;
  }
  const item: SessionListItem = {
    worldId,
    name,
    runState: stringField(record, "runState") ?? "paused",
    lifecycle: stringField(record, "lifecycle") ?? "active",
    updatedAt: stringField(record, "updatedAt") ?? "",
  };
  return item;
}

/**
 * zh: 读取字符串字段。
 * en: Read a string field.
 */
function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * zh: 调用 interpretAndDispatch，统一成数组。
 * en: Call interpretAndDispatch and always return an array.
 */
export async function interpretText(
  application: Application,
  text: string,
  origin: WorldCommand["origin"],
  worldId: string | undefined,
  requestedBy: string,
): Promise<CommandResult[]> {
  const result =
    worldId === undefined
      ? await application.interpretAndDispatch(text, origin)
      : await application.interpretAndDispatch(
          text,
          origin,
          worldId,
          requestedBy,
        );
  return Array.isArray(result) ? result : [result];
}

/**
 * zh: 若应用层提供 close，则调用。
 * en: Call close when the application layer provides it.
 */
export async function closeApplication(
  application: Application | undefined,
): Promise<void> {
  if (application === undefined) {
    return;
  }
  await application.close();
}
