import assert from "node:assert/strict";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import { t } from "../i18n/index.js";
import { createHttpApp } from "./create-http-app.js";
import { listenOnLoopback } from "./listen.js";
import { loadChatTemplate } from "./chat-page.js";
import type { Application, SessionView } from "./bind-application.js";
import type {
  ExportManifest,
  RuntimeSnapshot,
  WorldCommand,
  WorldEvent,
  WorldSessionRecord,
  WorldSnapshot,
} from "../schema/index.js";

const config: CarinaConfig = {
  apiKey: undefined,
  model: "gpt-4o-mini",
  modelBaseUrl: "https://api.openai.com/v1",
  token: "test-token",
  port: 18790,
  pack: undefined,
  lang: "zh",
  dataDir: "/tmp/carina-test-data",
};

/**
 * zh: 健康检查无需令牌。
 * en: Health does not require a token.
 */
test("GET /health is public", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
  });
  const res = await app.request("/health");
  assert.equal(res.status, 200);
  const body: unknown = await res.json();
  assert.deepEqual(body, {
    ok: true,
    name: "carina",
    workflow: {
      renderer: false,
      meshProvider: false,
      worldRuntime: false,
      depth: false,
      nativeMesh: "unset",
      worldModel: "unset",
    },
  });
});

/**
 * zh: 聊天接口拒绝无令牌请求。
 * en: Chat rejects requests without a token.
 */
test("POST /v1/chat requires a token", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "nope";
    },
  });
  const res = await app.request("/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { code: string; message: string };
  assert.equal(body.code, "UNAUTHORIZED");
  assert.equal(body.message, t("error.unauthorized", "zh"));
});

/**
 * zh: Bearer 与 X-Carina-Token 都能通过。
 * en: Both Bearer and X-Carina-Token are accepted.
 */
test("POST /v1/chat streams SSE with either auth header", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "hello";
      yield " world";
    },
  });
  const bearer = await app.request("/v1/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(bearer.status, 200);
  assert.match(bearer.headers.get("content-type") ?? "", /text\/event-stream/);
  const bearerText = await bearer.text();
  assert.match(bearerText, /event: text/);
  assert.match(bearerText, /hello/);
  assert.match(bearerText, /event: done/);

  const header = await app.request("/v1/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-carina-token": "test-token",
    },
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(header.status, 200);
  assert.match(await header.text(), /hello/);
});

/**
 * zh: 1×1 JPEG，仅用于契约测试。
 * en: 1×1 JPEG used only for contract tests.
 */
const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z";

/**
 * zh: look 静帧走 SSE，并可供 GET /v1/view 再取。
 * en: A look still goes out on SSE and can be fetched from GET /v1/view.
 */
test("POST /v1/chat still event is cached at GET /v1/view", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield { type: "status", tool: "look" };
      yield {
        type: "still",
        mime: "image/jpeg",
        base64: TINY_JPEG,
        width: 8,
        height: 8,
        placeId: "place-1",
      };
      yield "you see a lake";
    },
  });
  const missing = await app.request("/v1/view", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(missing.status, 404);

  const chat = await app.request("/v1/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({ message: "look" }),
  });
  assert.equal(chat.status, 200);
  const sse = await chat.text();
  assert.match(sse, /event: status/);
  assert.match(sse, /event: still/);
  assert.match(sse, /place-1/);
  assert.match(sse, /event: text/);
  assert.match(sse, /you see a lake/);

  const view = await app.request("/v1/view", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(view.status, 200);
  assert.match(view.headers.get("content-type") ?? "", /image\/jpeg/);
  const bytes = Buffer.from(await view.arrayBuffer());
  assert.equal(bytes.equals(Buffer.from(TINY_JPEG, "base64")), true);
});

/**
 * zh: look 短片走 SSE，末帧可供 GET /v1/view 再取。
 * en: A look clip goes out on SSE; the last frame is available at GET /v1/view.
 */
test("POST /v1/chat clip event updates the view cache", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield {
        type: "clip",
        mime: "image/jpeg",
        fps: 8,
        frames: [TINY_JPEG, TINY_JPEG],
        width: 8,
        height: 8,
        placeId: "place-1",
      };
    },
  });
  const chat = await app.request("/v1/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({ message: "look" }),
  });
  assert.equal(chat.status, 200);
  const sse = await chat.text();
  assert.match(sse, /event: clip/);
  assert.match(sse, /"fps":8/);
  const view = await app.request("/v1/view", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(view.status, 200);
  assert.match(view.headers.get("content-type") ?? "", /image\/jpeg/);
});

/**
 * zh: 首页注入中英词表与 data-i18n。
 * en: The home page injects both catalogs and data-i18n keys.
 */
test("GET / injects bilingual catalogs", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
  });
  const res = await app.request("/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="carina-boot"/);
  assert.match(html, /id="viewport"/);
  assert.match(html, /id="ps2-stream"/);
  assert.match(html, /id="stream-overlay"/);
  assert.match(html, /id="observation-badge"/);
  assert.match(html, /data-i18n="ui.emptyWorlds"/);
  assert.match(html, /id="export-drawer"/);
  assert.match(html, /id="toggle-chat"/);
  assert.match(html, /id="close-chat"/);
  assert.match(html, /id="export-pack"/);
  assert.match(html, /data-i18n="ui.exportTitle"/);
  assert.match(html, /carina-wordmark\.png/);
  assert.match(html, /carina-mark\.png/);
  assert.match(html, /龙骨管家/);
  assert.match(html, /Carina steward/);
  const boot = parseBoot(html);
  assert.equal(boot.token, "test-token");
  assert.equal(boot.lang, "zh");
  assert.equal(typeof boot.catalogs?.zh?.["ui.product"], "string");
  assert.equal(boot.pixelStreamingUrl, "http://192.168.5.16:8080");
});

/**
 * zh: 串流信令探测需要令牌；HTTP 200 不算 WebRTC。
 * en: Signalling probe requires a token and HTTP 200 is not WebRTC.
 */
test("GET /v1/play/signalling requires a token", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
  });
  const denied = await app.request("/v1/play/signalling");
  assert.equal(denied.status, 401);
  const res = await app.request("/v1/play/signalling", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.ok(res.status === 200 || res.status === 503);
  const body = (await res.json()) as { ok?: unknown; url?: unknown };
  assert.equal(typeof body.ok, "boolean");
  assert.match(String(body.url), /player\.html/);
});

/**
 * zh: daemon 只绑 127.0.0.1。
 * en: The daemon binds 127.0.0.1 only.
 */
test("listenOnLoopback binds 127.0.0.1", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "ok";
    },
  });
  const listening = await listenOnLoopback(app, 0);
  try {
    assert.match(listening.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const res = await fetch(new URL("/health", listening.url));
    assert.equal(res.status, 200);
  } finally {
    await listening.close();
  }
});

/**
 * zh: 品牌字标公开可读，路径不可逃出白名单。
 * en: Brand wordmark is public; paths cannot escape the allowlist.
 */
test("GET /brand/carina-wordmark.png is public", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
  });
  const res = await app.request("/brand/carina-wordmark.png");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /image\/png/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(bytes.length > 1000);
  assert.equal(
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    true,
  );

  const mark = await app.request("/brand/carina-mark.png");
  assert.equal(mark.status, 200);
  assert.match(mark.headers.get("content-type") ?? "", /image\/png/);

  const favicon = await app.request("/favicon.ico");
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type") ?? "", /image\/png/);

  const blocked = await app.request("/brand/../app.html");
  assert.equal(blocked.status, 404);
});

/**
 * zh: 旧聊天页仍可从 /legacy 打开。
 * en: The legacy chat page is still served at /legacy.
 */
test("GET /legacy injects chat catalogs", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
  });
  const res = await app.request("/legacy");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /data-i18n="chat.stageEmpty"/);
  assert.match(html, /id="carina-boot"/);
  const template = loadChatTemplate();
  const keys = [
    ...template.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(keys.includes("chat.title"));
  assert.ok(keys.includes("chat.send"));
});

/**
 * zh: 世界列表需要令牌。
 * en: Session list requires a token.
 */
test("GET /v1/sessions requires a token", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
  });
  const res = await app.request("/v1/sessions");
  assert.equal(res.status, 401);
  const body = (await res.json()) as { code: string; message: string };
  assert.equal(body.code, "UNAUTHORIZED");
  assert.equal(body.message, t("error.unauthorized", "zh"));

  const withToken = await app.request("/v1/sessions", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(withToken.status, 503);
  const missing = (await withToken.json()) as { code: string };
  assert.equal(missing.code, "WORLD_NOT_ACTIVE");
});

/**
 * zh: 暂停控制走 application，不需要 apiKey。
 * en: Pause control uses application and does not need an apiKey.
 */
test("POST control pause is accepted without apiKey", async () => {
  let last: WorldCommand | undefined;
  const application = fakeApplication({
    dispatchCommand: async (command) => {
      last = command;
      return {
        commandId: command.commandId,
        worldId: command.worldId ?? "01WORLD",
        accepted: true,
      };
    },
  });
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
    application,
  });
  const res = await app.request("/v1/sessions/01WORLD/control", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({ action: "pause" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { accepted: boolean };
  assert.equal(body.accepted, true);
  assert.equal(last?.intentKind, "world.pause");
  assert.equal(config.apiKey, undefined);
});

/**
 * zh: 有假 application 时列表与 runtime 盒子可返回。
 * en: With a fake application, list and runtime boxes are returned.
 */
test("GET session map returns a walkable room", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
    application: fakeApplication({}),
  });
  const res = await app.request("/v1/sessions/01WORLD/map", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { offlinePlayable?: boolean; objects?: unknown[] };
  assert.equal(body.offlinePlayable, true);
  assert.ok(Array.isArray(body.objects) && body.objects.length >= 1);
});

/**
 * zh: 观测 GET 可从 hydrate 取出候选静帧，不是网格。
 * en: Observation GET hydrates a candidate still, not a mesh.
 */
test("GET observation hydrates a candidate still", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
    application: fakeApplication({
      async hydrateObservation() {
        return {
          media: "view",
          provider: "lingbot-legacy",
          legacy: true,
          frozen: false,
          still: { mime: "image/jpeg", base64: "AAAA" },
        };
      },
    }),
  });
  const res = await app.request("/v1/sessions/01WORLD/observation", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    frozen?: unknown;
    still?: { base64?: string };
    clip?: unknown;
  };
  assert.equal(body.frozen, false);
  assert.equal(body.still?.base64, "AAAA");
  assert.equal(body.clip, undefined);
});

/**
 * zh: 有假 application 时列表与 runtime 盒子可返回。
 * en: With a fake application, list and runtime boxes are returned.
 */
test("GET /v1/sessions and runtime work with a fake application", async () => {
  const application = fakeApplication({});
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
    application,
  });
  const listed = await app.request("/v1/sessions", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(listed.status, 200);
  const listBody = (await listed.json()) as {
    worlds: Array<{ worldId: string; name: string }>;
  };
  assert.equal(listBody.worlds.length, 1);
  assert.equal(listBody.worlds[0]?.name, "酒馆");

  const runtime = await app.request("/v1/sessions/01WORLD/runtime", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(runtime.status, 200);
  const snap = (await runtime.json()) as RuntimeSnapshot;
  assert.ok(snap.objects.length >= 3);
});

/**
 * zh: SSE 可用查询串 token（EventSource 不能设头）。
 * en: SSE accepts a query token (EventSource cannot set headers).
 */
test("GET session events accepts query token", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
    application: fakeApplication({}),
  });
  const res = await app.request("/v1/sessions/01WORLD/events?token=test-token");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /world.paused/);
});

/**
 * zh: 建模 GLB 与世界包都可从 HTTP 下载。
 * en: Modeling GLB and world pack are both downloadable over HTTP.
 */
test("POST exports downloads glb or world pack", async () => {
  const app = createHttpApp(config, {
    runTurn: async function* () {
      yield "";
    },
    application: fakeApplication({}),
  });
  const glb = await app.request("/v1/sessions/01WORLD/exports", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(glb.status, 200);
  assert.match(glb.headers.get("content-type") ?? "", /gltf-binary/);
  const glbBytes = Buffer.from(await glb.arrayBuffer());
  assert.equal(glbBytes.subarray(0, 4).equals(Buffer.from("glTF")), true);

  const pack = await app.request(
    "/v1/sessions/01WORLD/exports?profile=world_pack",
    {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
    },
  );
  assert.equal(pack.status, 200);
  assert.match(pack.headers.get("content-type") ?? "", /zip/);
  assert.match(pack.headers.get("content-disposition") ?? "", /filename\*=UTF-8''/);
  const zipBytes = Buffer.from(await pack.arrayBuffer());
  assert.equal(zipBytes.subarray(0, 2).equals(Buffer.from("PK")), true);
});

/**
 * zh: 从 HTML 取出 carina-boot JSON。
 * en: Parse carina-boot JSON from HTML.
 */
function parseBoot(html: string): {
  lang?: unknown;
  token?: unknown;
  pixelStreamingUrl?: unknown;
  catalogs?: { zh?: Record<string, string> };
} {
  const match = html.match(
    /<script type="application\/json" id="carina-boot">([^<]+)<\/script>/,
  );
  assert.ok(match?.[1]);
  return JSON.parse(match[1]) as {
    lang?: unknown;
    token?: unknown;
    pixelStreamingUrl?: unknown;
    catalogs?: { zh?: Record<string, string> };
  };
}

/**
 * zh: 测试用假 application。
 * en: Fake application for tests.
 */
function fakeApplication(
  overrides: Partial<Application>,
): Application {
  const session = sampleSession("01WORLD", "酒馆");
  const runtime = sampleRuntime("01WORLD");
  const view: SessionView = {
    session,
    snapshot: sampleSnapshot(session, runtime),
    runtime,
    worldDocuments: {
      "WORLD.md": { body: "# 世界\n", hash: "h1" },
      "PLAYER.md": { body: "", hash: "h2" },
      "STEWARD.md": { body: "", hash: "h3" },
      "MEMORY.md": { body: "", hash: "h4" },
    },
    globalDocuments: {
      "IDENTITY.md": "威廉",
      "AGENT.md": "",
      "GLOBAL.md": "",
    },
  };
  const base: Application = {
    async dispatchCommand(command) {
      return {
        commandId: command.commandId,
        worldId: command.worldId ?? session.sessionId,
        accepted: true,
      };
    },
    async interpretAndDispatch() {
      return {
        commandId: "cmd",
        worldId: session.sessionId,
        accepted: true,
      };
    },
    async listSessions() {
      return [session];
    },
    async getSessionView() {
      return view;
    },
    async *subscribeEvents(): AsyncIterable<WorldEvent> {
      yield {
        eventId: "evt1",
        worldId: session.sessionId,
        type: "world.paused",
        createdAt: session.updatedAt,
        payload: {},
      };
    },
    async exportGlb() {
      return {
        glb: new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
        manifest: sampleManifest(session.sessionId),
      };
    },
    async exportPack() {
      return {
        zip: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        name: session.name,
        revision: session.headRevision,
      };
    },
    async getCommittedMap() {
      return sampleMap(session.sessionId);
    },
    async readPackAsset() {
      return { bytes: new Uint8Array([1, 2, 3]), mime: "application/octet-stream" };
    },
    async stagePackAsset() {
      const hash = "a".repeat(64);
      return { hash, posixPath: `assets/${hash}.glb` };
    },
    async close() {},
  };
  return { ...base, ...overrides };
}

function sampleSession(worldId: string, name: string): WorldSessionRecord {
  return {
    sessionId: worldId,
    name,
    schemaVersion: 1,
    lifecycle: "active",
    runState: "paused",
    headRevision: "rev1",
    controlEpoch: 0,
    simTime: 0,
    playerStateRef: "player",
    worldRulesRef: "rules",
    ruleDocumentRefs: {},
    globalProfileRef: "profile",
    activeRegionId: null,
    budgetPolicy: {
      maxAutoJobs: 2,
      maxRepairAttempts: 2,
      maxRunSeconds: 3600,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sampleRuntime(worldId: string): RuntimeSnapshot {
  return {
    worldId,
    revision: "rev1",
    controlEpoch: 0,
    simTime: 0,
    runState: "paused",
    player: {
      position: { x: 0, y: 0.8, z: 1.2 },
      yaw: 0,
      holdingObjectIds: [],
    },
    objects: [
      {
        sceneObjectId: "table",
        position: { x: 1.1, y: 0.4, z: 0.2 },
        rotationY: 0,
      },
      {
        sceneObjectId: "chair",
        position: { x: -0.8, y: 0.35, z: 0.6 },
        rotationY: 0.4,
      },
      {
        sceneObjectId: "door",
        position: { x: 0, y: 1, z: -2 },
        rotationY: 0,
        open: false,
      },
    ],
    npcs: [
      {
        sceneObjectId: "keeper",
        position: { x: 0.5, y: 0.9, z: 1.4 },
      },
    ],
  };
}

function sampleSnapshot(
  session: WorldSessionRecord,
  runtime: RuntimeSnapshot,
): WorldSnapshot {
  return {
    revision: session.headRevision,
    parentRevision: null,
    worldId: session.sessionId,
    createdAt: session.createdAt,
    session,
    graph: { version: 0, nodes: [], edges: [] },
    worldRules: {
      revision: session.headRevision,
      sourceHash: "h1",
      clauses: [],
      stewardConstraints: [],
    },
    regions: [],
    objects: [],
    simTime: runtime.simTime,
    controlEpoch: runtime.controlEpoch,
    assetManifest: [],
  };
}

function sampleMap(worldId: string) {
  return {
    revision: "rev1",
    worldId,
    offlinePlayable: true,
    frozenRegionCount: 1,
    regionCount: 1,
    eyeHeight: 1.6,
    captureCamera: {
      position: { x: 4, y: 1.6, z: 2 },
      yaw: 0,
      pitch: 0,
      fovY: 1.05,
      aspect: 832 / 480,
    },
    regions: [
      {
        regionId: "interior",
        name: "酒馆",
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 4, z: 6 } },
        freezeState: "frozen" as const,
        quality: "playable" as const,
        neighborPortals: [],
      },
    ],
    objects: [
      {
        sceneObjectId: "floor",
        name: "地板",
        mobility: "static" as const,
        interactionProfile: "none" as const,
        transform: {
          position: { x: 4, y: 0, z: 3 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        bounds: { min: { x: 0, y: -0.1, z: 0 }, max: { x: 8, y: 0, z: 6 } },
        collider: true,
        mesh: {
          schemaVersion: 1 as const,
          kind: "triangle_mesh" as const,
          sceneObjectId: "floor",
          name: "地板",
          positions: [0, 0, 0, 1, 0, 0, 1, 0, 1],
          normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
          uvs: [0, 0, 1, 0, 1, 1],
          indices: [0, 1, 2],
          albedo: [0.4, 0.3, 0.2] as [number, number, number],
        },
      },
    ],
  };
}

function sampleManifest(worldId: string): ExportManifest {
  return {
    exportId: "exp1",
    worldId,
    snapshotRevision: "rev1",
    profile: "blender_glb",
    coordinateFrame: {
      up: "y",
      handedness: "right",
      units: "meters",
      scaleStatus: "unknown",
    },
    units: "meters",
    files: [],
    objectMapping: [],
    materialMapping: [],
    sourceAssets: [],
    license: "none",
    unsupportedFeatures: [],
    validationResults: [],
  };
}
