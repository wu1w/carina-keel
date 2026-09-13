import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { CarinaConfig } from "../config.js";
import { CarinaError, type CarinaErrorCode } from "../errors.js";
import { formatUserError } from "../i18n/user-error.js";
import { isMessageKey, t, type MessageKey } from "../i18n/index.js";
import {
  GLOBAL_DOCUMENT_IDS,
  WORLD_DOCUMENT_IDS,
  worldCommandSchema,
  type IntentKind,
  type WorldCommand,
} from "../schema/index.js";
import { sha256Hex } from "../pack/hash.js";
import { listCheckpoints } from "../pack/index.js";
import { createUlid } from "../world/ids.js";
import { createSceneService, positionSchema } from "../world-scene/service.js";
import { createExplorationLoader } from "./exploration.js";
import { createExplorationAtlas, prefetchSchema } from "./exploration-atlas.js";
import {
  interpretText,
  normalizeSessionList,
  type Application,
} from "./bind-application.js";

const GLOBAL_IDS = new Set<string>(Object.values(GLOBAL_DOCUMENT_IDS));
const WORLD_IDS = new Set<string>(Object.values(WORLD_DOCUMENT_IDS));

const createSessionBodySchema = z.object({
  name: z.string().min(1),
  text: z.string().optional(),
});

const controlBodySchema = z.object({
  action: z.enum(["pause", "run", "step", "stopNavigation"]),
  seconds: z.number().positive().optional(),
});

const documentPutSchema = z
  .object({
    body: z.string().optional(),
    append: z.string().optional(),
    expectedHash: z.string().min(1).optional(),
    expectedRevision: z.string().min(1).optional(),
  })
  .refine(
    (value) => value.body !== undefined || value.append !== undefined,
    { message: "body" },
  );

const textCommandSchema = z.object({
  text: z.string().min(1),
});

/**
 * zh: 挂上 /v1/sessions 与规则/导出路由。无 application 时返回 503。
 * en: Mount /v1/sessions plus rules/export routes. 503 when application is missing.
 */
export function registerSessionRoutes(
  app: Hono,
  config: CarinaConfig,
  application: Application | undefined,
): void {
  const lang = config.lang;
  const loadExploration = createExplorationLoader(config);
  const atlas = createExplorationAtlas(config);
  const scenes = createSceneService(config, {source:loadExploration});
  app.post("/v1/sessions/:worldId/scene/prepare",c=>withApplication(c,application,lang,async bound=>c.json(await scenes.prepare(bound,c.req.param("worldId")),202)));
  app.get("/v1/sessions/:worldId/scene",c=>withApplication(c,application,lang,async bound=>{
    await bound.getCommittedMap(c.req.param("worldId"));return c.json(scenes.status(c.req.param("worldId")));
  }));
  app.post("/v1/sessions/:worldId/scene/stream",c=>withApplication(c,application,lang,async bound=>{
    const parsed=positionSchema.safeParse(await readJson(c,lang));if(!parsed.success)return jsonError(c,"CONFIG",400,lang,"error.badRequest");
    await bound.getCommittedMap(c.req.param("worldId"));return c.json(await scenes.heartbeat(c.req.param("worldId"),parsed.data));
  }));
  app.get("/v1/sessions/:worldId/scene/chunks/:chunk",c=>withApplication(c,application,lang,async bound=>{
    await bound.getCommittedMap(c.req.param("worldId"));const result=await scenes.chunk(c.req.param("worldId"),c.req.param("chunk"));
    return c.body(new Uint8Array(result.bytes),200,{"Content-Type":"model/gltf-binary","Cache-Control":"private, max-age=31536000, immutable"});
  }));
  app.get("/v1/sessions/:worldId/scene/colliders/:chunk",c=>withApplication(c,application,lang,async bound=>{
    await bound.getCommittedMap(c.req.param("worldId"));return c.json(scenes.colliders(c.req.param("worldId"),c.req.param("chunk")));
  }));
  app.get("/v1/sessions/:worldId/scene/archive",c=>withApplication(c,application,lang,async bound=>{
    await bound.getCommittedMap(c.req.param("worldId"));return c.body(new Uint8Array(await scenes.archive(c.req.param("worldId"))),200,{"Content-Type":"application/zip","Content-Disposition":"attachment; filename=world-scene.zip"});
  }));
  app.get("/v1/sessions/:worldId/scene/export",c=>withApplication(c,application,lang,async bound=>{
    await bound.getCommittedMap(c.req.param("worldId"));return c.body(new Uint8Array(await scenes.exportScene(c.req.param("worldId"))),200,{"Content-Type":"model/gltf-binary","Content-Disposition":"attachment; filename=world-scene.glb"});
  }));

  app.get("/v1/sessions/:worldId/exploration/atlas", c => withApplication(c, application, lang, async bound => {
    await bound.getCommittedMap(c.req.param("worldId"));
    return c.json(await atlas.status(c.req.param("worldId"), c.req.query("root") ?? ""));
  }));
  app.get("/v1/sessions/:worldId/exploration/nodes/:nodeId", c => withApplication(c, application, lang, async bound => {
    await bound.getCommittedMap(c.req.param("worldId"));
    return c.json(await atlas.read(c.req.param("worldId"), c.req.query("root") ?? "", c.req.param("nodeId")));
  }));
  app.post("/v1/sessions/:worldId/exploration/prefetch", c => withApplication(c, application, lang, async bound => {
    const parsed=prefetchSchema.safeParse(await readJson(c,lang));
    if (!parsed.success) return jsonError(c,"CONFIG",400,lang,"error.badRequest");
    await bound.getCommittedMap(c.req.param("worldId"));
    return c.json(await atlas.prefetch(c.req.param("worldId"),parsed.data),202);
  }));

  app.get("/v1/sessions/:worldId/exploration", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      try {
        const surface = await loadExploration(bound, c.req.param("worldId"));
        const root = await atlas.ensureRoot(c.req.param("worldId"), surface);
        return c.json({ ...surface, root, id: root });
      } catch {
        return jsonError(c, "INTERNAL", 503, lang, "error.internal");
      }
    });
  });

  app.get("/v1/sessions", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const listed = normalizeSessionList(await bound.listSessions());
      return c.json(listed);
    });
  });

  app.post("/v1/sessions", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const json = await readJson(c, lang);
      if (json instanceof Response) {
        return json;
      }
      const parsed = createSessionBodySchema.safeParse(json);
      if (!parsed.success) {
        return jsonError(c, "CONFIG", 400, lang, "error.badRequest");
      }
      const args: Record<string, unknown> = { name: parsed.data.name };
      if (parsed.data.text !== undefined) {
        args["text"] = parsed.data.text;
      }
      const result = await bound.dispatchCommand(
        command({
          intentKind: "session.create",
          arguments: args,
          origin: "button",
          mode: "author",
        }),
      );
      return c.json(result);
    });
  });

  app.post("/v1/sessions/:worldId/open", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const worldId = c.req.param("worldId");
      const result = await bound.dispatchCommand(
        command({
          worldId,
          intentKind: "session.open",
          arguments: {},
          origin: "button",
          mode: "author",
        }),
      );
      return c.json(result);
    });
  });

  app.post("/v1/sessions/:worldId/commands", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const worldId = c.req.param("worldId");
      const json = await readJson(c, lang);
      if (json instanceof Response) {
        return json;
      }
      const asText = textCommandSchema.safeParse(json);
      const record =
        json !== null && typeof json === "object"
          ? (json as Record<string, unknown>)
          : {};
      if (asText.success && record["intentKind"] === undefined) {
        const results = await interpretText(
          bound,
          asText.data.text,
          "natural_language",
          worldId,
          "user",
        );
        return c.json(results.length === 1 ? results[0] : results);
      }
      const parsed = worldCommandSchema.safeParse({
        commandId:
          typeof record["commandId"] === "string" && record["commandId"] !== ""
            ? record["commandId"]
            : createUlid(),
        origin: "button",
        mode: "author",
        requestedBy: "user",
        arguments: {},
        ...record,
        worldId,
      });
      if (!parsed.success) {
        return jsonError(c, "CONFIG", 400, lang, "error.badRequest");
      }
      const result = await bound.dispatchCommand(parsed.data);
      return c.json(result);
    });
  });

  app.post("/v1/sessions/:worldId/control", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const worldId = c.req.param("worldId");
      const json = await readJson(c, lang);
      if (json instanceof Response) {
        return json;
      }
      const parsed = controlBodySchema.safeParse(json);
      if (!parsed.success) {
        return jsonError(c, "CONFIG", 400, lang, "error.badRequest");
      }
      const mapped = controlCommand(worldId, parsed.data);
      const result = await bound.dispatchCommand(mapped);
      return c.json(result);
    });
  });

  app.get("/v1/sessions/:worldId/events", (c) => {
    if (application === undefined) {
      return jsonError(
        c,
        "WORLD_NOT_ACTIVE",
        503,
        lang,
        "error.worldNotActive",
      );
    }
    const worldId = c.req.param("worldId");
    const lastEventId =
      c.req.header("last-event-id") ?? c.req.query("lastEventId");
    const bound = application;
    const signal = c.req.raw.signal;
    return streamSSE(c, async (stream) => {
      try {
        const iterable =
          lastEventId === undefined || lastEventId === ""
            ? await bound.subscribeEvents(worldId)
            : await bound.subscribeEvents(worldId, lastEventId);
        for await (const event of iterable) {
          if (signal.aborted) {
            return;
          }
          await stream.writeSSE({
            id: event.eventId,
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      } catch (err) {
        const code = err instanceof CarinaError ? err.code : "INTERNAL";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            code,
            message: formatUserError(err, lang),
          }),
        });
      }
    });
  });

  app.get("/v1/sessions/:worldId/checkpoints", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const worldId = c.req.param("worldId");
      const view = await bound.getSessionView(worldId);
      const packDir = packDirOfWorld(await bound.listSessions(), worldId);
      const checkpoints =
        packDir !== undefined
          ? await listCheckpoints(packDir)
          : [
              {
                revision: view.snapshot.revision,
                parentRevision: view.snapshot.parentRevision,
                createdAt: view.snapshot.createdAt,
                summary: "",
                current: true,
              },
            ];
      return c.json({
        worldId,
        currentRevision: view.snapshot.revision,
        checkpoints,
      });
    });
  });

  app.get("/v1/sessions/:worldId/snapshot", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const view = await bound.getSessionView(c.req.param("worldId"));
      return c.json(sessionViewWithoutBinaries(view));
    });
  });

  app.get("/v1/sessions/:worldId/runtime", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const view = await bound.getSessionView(c.req.param("worldId"));
      return c.json(view.runtime);
    });
  });

  app.get("/v1/sessions/:worldId/map", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const map = await bound.getCommittedMap(c.req.param("worldId"));
      return c.json(map);
    });
  });

  app.get("/v1/sessions/:worldId/assets/:fileName", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const parsed = splitAssetFileName(c.req.param("fileName"));
      if (parsed === undefined) {
        return jsonError(c, "NOT_FOUND", 404, lang, "error.notFound");
      }
      const asset = await bound.readPackAsset(
        c.req.param("worldId"),
        parsed.hash,
        parsed.ext,
      );
      return new Response(Uint8Array.from(asset.bytes), {
        status: 200,
        headers: {
          "content-type": asset.mime,
          "cache-control": "no-store",
        },
      });
    });
  });

  app.get("/v1/sessions/:worldId/observation", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const worldId = c.req.param("worldId");
      const observation = bound.hydrateObservation
        ? await bound.hydrateObservation(worldId)
        : bound.getObservation?.(worldId);
      if (observation === undefined) {
        return jsonError(c, "NOT_FOUND", 404, lang, "error.notFound");
      }
      return c.json(observation);
    });
  });

  app.get("/v1/sessions/:worldId/documents/:documentId", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const documentId = c.req.param("documentId");
      if (!WORLD_IDS.has(documentId)) {
        return jsonError(c, "NOT_FOUND", 404, lang, "error.notFound");
      }
      const view = await bound.getSessionView(c.req.param("worldId"));
      const doc = view.worldDocuments[documentId];
      if (doc === undefined) {
        return jsonError(c, "NOT_FOUND", 404, lang, "error.notFound");
      }
      return c.json({
        documentId,
        scope: "world",
        body: doc.body,
        hash: doc.hash,
      });
    });
  });

  app.put("/v1/sessions/:worldId/documents/:documentId", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const documentId = c.req.param("documentId");
      if (!WORLD_IDS.has(documentId)) {
        return jsonError(c, "NOT_FOUND", 404, lang, "error.notFound");
      }
      const json = await readJson(c, lang);
      if (json instanceof Response) {
        return json;
      }
      const parsed = documentPutSchema.safeParse(json);
      if (!parsed.success) {
        return jsonError(c, "CONFIG", 400, lang, "error.badRequest");
      }
      const result = await bound.dispatchCommand(
        rulesUpdateCommand({
          worldId: c.req.param("worldId"),
          scope: "world",
          documentId,
          put: parsed.data,
        }),
      );
      return c.json(result);
    });
  });

  app.get("/v1/profile/documents/:documentId", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const documentId = c.req.param("documentId");
      if (!GLOBAL_IDS.has(documentId)) {
        return jsonError(c, "NOT_FOUND", 404, lang, "error.notFound");
      }
      const body = await readGlobalDocument(bound, documentId);
      if (body === undefined) {
        return jsonError(c, "NOT_FOUND", 404, lang, "error.notFound");
      }
      return c.json({
        documentId,
        scope: "global",
        body,
        hash: sha256Hex(body),
      });
    });
  });

  app.put("/v1/profile/documents/:documentId", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const documentId = c.req.param("documentId");
      if (!GLOBAL_IDS.has(documentId)) {
        return jsonError(c, "NOT_FOUND", 404, lang, "error.notFound");
      }
      const json = await readJson(c, lang);
      if (json instanceof Response) {
        return json;
      }
      const parsed = documentPutSchema.safeParse(json);
      if (!parsed.success) {
        return jsonError(c, "CONFIG", 400, lang, "error.badRequest");
      }
      const result = await bound.dispatchCommand(
        rulesUpdateCommand({
          scope: "global",
          documentId,
          put: parsed.data,
        }),
      );
      return c.json(result);
    });
  });

  app.post("/v1/sessions/:worldId/exports", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const worldId = c.req.param("worldId");
      const profile = c.req.query("profile") ?? "blender_glb";
      if (profile === "world_pack") {
        const exported = await bound.exportPack(worldId);
        const filename = downloadFilename(exported.name, "carina.zip");
        return new Response(exported.zip, {
          status: 200,
          headers: {
            "content-type": "application/zip",
            "content-disposition": contentDisposition(filename),
            "cache-control": "no-store",
          },
        });
      }
      const exported = await bound.exportGlb(worldId);
      const bytes = exported.glb;
      const filename = `${worldId}.glb`;
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/gltf-binary",
          "content-disposition": contentDisposition(filename),
          "x-carina-export-id": exported.manifest.exportId,
          "cache-control": "no-store",
        },
      });
    });
  });

  app.post("/v1/sessions/:worldId/jobs/:jobId/cancel", (c) => {
    return withApplication(c, application, lang, async (bound) => {
      const result = await bound.dispatchCommand(
        command({
          worldId: c.req.param("worldId"),
          intentKind: "generation.stop",
          arguments: { jobId: c.req.param("jobId") },
          origin: "button",
          mode: "author",
        }),
      );
      return c.json(result);
    });
  });
}

/**
 * zh: EventSource 不能设 Authorization，仅本路由允许 ?token=。
 * en: EventSource cannot set headers; only this route accepts ?token=.
 */
export function isSessionEventsGet(method: string, path: string): boolean {
  return method === "GET" && /^\/v1\/sessions\/[^/]+\/events$/.test(path);
}

/**
 * zh: 暂停/运行/单步/停步：高优先级，不经过 LLM。
 * en: Pause/run/step/stop-move: high priority, no LLM.
 */
function controlCommand(
  worldId: string,
  body: z.infer<typeof controlBodySchema>,
): WorldCommand {
  if (body.action === "pause") {
    return command({
      worldId,
      intentKind: "world.pause",
      arguments: {},
      origin: "button",
      mode: "author",
    });
  }
  if (body.action === "run") {
    return command({
      worldId,
      intentKind: "world.run",
      arguments: {},
      origin: "button",
      mode: "author",
    });
  }
  if (body.action === "step") {
    const seconds = body.seconds ?? 1 / 20;
    return command({
      worldId,
      intentKind: "world.step",
      arguments: { seconds },
      origin: "button",
      mode: "author",
    });
  }
  return command({
    worldId,
    intentKind: "player.stopNavigation",
    arguments: {},
    origin: "button",
    mode: "player",
  });
}

/**
 * zh: 组装 rules.update。
 * en: Build a rules.update command.
 */
function rulesUpdateCommand(input: {
  worldId?: string;
  scope: "global" | "world";
  documentId: string;
  put: z.infer<typeof documentPutSchema>;
}): WorldCommand {
  const arguments_: Record<string, unknown> = {
    scope: input.scope,
    documentId: input.documentId,
  };
  if (input.put.body !== undefined) {
    arguments_["body"] = input.put.body;
  }
  if (input.put.append !== undefined) {
    arguments_["append"] = input.put.append;
  }
  if (input.put.expectedHash !== undefined) {
    arguments_["expectedHash"] = input.put.expectedHash;
  }
  const expectedRevision = input.put.expectedRevision;
  return command({
    ...(input.worldId !== undefined ? { worldId: input.worldId } : {}),
    intentKind: "rules.update",
    arguments: arguments_,
    origin: "button",
    mode: "author",
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  });
}

/**
 * zh: 组装一条世界命令。
 * en: Build one world command.
 */
function command(input: {
  worldId?: string;
  intentKind: IntentKind;
  arguments: Record<string, unknown>;
  origin: WorldCommand["origin"];
  mode: WorldCommand["mode"];
  expectedRevision?: string;
}): WorldCommand {
  const base: WorldCommand = {
    commandId: createUlid(),
    intentKind: input.intentKind,
    arguments: input.arguments,
    origin: input.origin,
    mode: input.mode,
    requestedBy: "user",
  };
  if (input.worldId !== undefined) {
    base.worldId = input.worldId;
  }
  if (input.expectedRevision !== undefined) {
    base.expectedRevision = input.expectedRevision;
  }
  return base;
}

/**
 * zh: 去掉快照里可能出现的字节字段。
 * en: Strip any byte fields that might appear on a snapshot.
 */
/**
 * zh: 解析 assets/<sha256>.<ext> 文件名。
 * en: Parse a content-addressed asset filename.
 */
function splitAssetFileName(
  fileName: string,
): { hash: string; ext: string } | undefined {
  const match = /^([0-9a-f]{64})\.(.+)$/.exec(fileName);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  if (match[2].includes("/") || match[2].includes("\\") || match[2].includes("\0")) {
    return undefined;
  }
  return { hash: match[1], ext: match[2] };
}

function sessionViewWithoutBinaries(view: {
  session: unknown;
  snapshot: unknown;
  runtime: unknown;
  worldDocuments: unknown;
  globalDocuments: unknown;
}): unknown {
  return {
    session: view.session,
    runtime: view.runtime,
    worldDocuments: view.worldDocuments,
    globalDocuments: view.globalDocuments,
    snapshot: stripBytes(view.snapshot),
  };
}

/**
 * zh: 下载文件名，去掉路径分隔符。
 * en: Sanitize a download filename; strip path separators.
 */
function downloadFilename(name: string, ext: string): string {
  const stem = name.replace(/[/\\?%*:|"<>]/g, "-").trim();
  const safe = stem.length > 0 ? stem : "world";
  return `${safe}.${ext}`;
}

/**
 * zh: Content-Disposition；ASCII 回退加 RFC 5987 文件名。
 * en: Content-Disposition with ASCII fallback and RFC 5987 filename.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const star = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

/**
 * zh: 递归去掉 Uint8Array / ArrayBuffer。
 * en: Recursively drop Uint8Array / ArrayBuffer values.
 */
function stripBytes(value: unknown): unknown {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(stripBytes);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested instanceof Uint8Array || nested instanceof ArrayBuffer) {
        continue;
      }
      out[key] = stripBytes(nested);
    }
    return out;
  }
  return value;
}

/**
 * zh: 从 listSessions 原形取出某世界的 packDir。
 * en: Read a world's packDir from the raw listSessions shape.
 */
function packDirOfWorld(raw: unknown, worldId: string): string | undefined {
  const rows = Array.isArray(raw)
    ? raw
    : raw !== null &&
        typeof raw === "object" &&
        Array.isArray((raw as { worlds?: unknown }).worlds)
      ? (raw as { worlds: unknown[] }).worlds
      : [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const id =
      (typeof record["worldId"] === "string" && record["worldId"]) ||
      (typeof record["sessionId"] === "string" && record["sessionId"]) ||
      "";
    const packDir = record["packDir"];
    if (id === worldId && typeof packDir === "string" && packDir.length > 0) {
      return packDir;
    }
  }
  return undefined;
}

/**
 * zh: 从任一已打开世界读全局文档正文。
 * en: Read a global document body from any open world view.
 */
async function readGlobalDocument(
  application: Application,
  documentId: string,
): Promise<string | undefined> {
  const listed = normalizeSessionList(await application.listSessions());
  const worldId = listed.activeWorldId ?? listed.worlds[0]?.worldId;
  if (worldId === undefined) {
    throw new CarinaError("WORLD_NOT_ACTIVE", "error.worldNotActive");
  }
  const view = await application.getSessionView(worldId);
  const body = view.globalDocuments[documentId];
  return typeof body === "string" ? body : undefined;
}

/**
 * zh: 读取 JSON；空 body 当作 {}。
 * en: Read JSON; treat an empty body as {}.
 */
async function readJson(
  c: Context,
  lang: CarinaConfig["lang"],
): Promise<unknown | Response> {
  let raw: string;
  try {
    raw = await c.req.text();
  } catch {
    return jsonError(c, "CONFIG", 400, lang, "error.badRequest");
  }
  if (raw.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return jsonError(c, "CONFIG", 400, lang, "error.badRequest");
  }
}

/**
 * zh: 无 application 时 503；否则捕获 CarinaError。
 * en: 503 without application; otherwise map CarinaError.
 */
async function withApplication(
  c: Context,
  application: Application | undefined,
  lang: CarinaConfig["lang"],
  fn: (application: Application) => Promise<Response>,
): Promise<Response> {
  if (application === undefined) {
    return jsonError(
      c,
      "WORLD_NOT_ACTIVE",
      503,
      lang,
      "error.worldNotActive",
    );
  }
  try {
    return await fn(application);
  } catch (err) {
    if (err instanceof CarinaError) {
      return jsonError(
        c,
        err.code,
        statusFor(err.code),
        lang,
                isMessageKey(err.messageKey) ? err.messageKey : "error.internal",
              );
            }
            return jsonError(c, "INTERNAL", 500, lang, "error.internal");
          }
        }

        /**
         * zh: 错误码到 HTTP 状态。
         * en: Map an error code to an HTTP status.
         */
        function statusFor(code: CarinaErrorCode): 400 | 401 | 404 | 409 | 500 | 503 {
          if (code === "UNAUTHORIZED") {
            return 401;
          }
          if (code === "NOT_FOUND") {
            return 404;
          }
          if (code === "WORLD_NOT_ACTIVE") {
            return 503;
          }
          if (code === "CONFIG" || code === "TOOL_INPUT" || code === "RULES_INVALID") {
            return 400;
          }
          if (
            code === "CONFLICT" ||
            code === "REVISION_CONFLICT" ||
            code === "COMMAND_REJECTED" ||
            code === "EPOCH_STALE"
          ) {
            return 409;
          }
          return 500;
        }

        /**
         * zh: JSON 错误体。
         * en: JSON error body.
         */
        function jsonError(
          c: Context,
          code: CarinaErrorCode,
          status: 400 | 401 | 404 | 409 | 500 | 503,
          lang: CarinaConfig["lang"],
          messageKey: MessageKey,
        ): Response {
          return c.json({ code, message: t(messageKey, lang) }, status);
        }
