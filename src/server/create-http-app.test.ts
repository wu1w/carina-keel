import assert from "node:assert/strict";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import { t } from "../i18n/index.js";
import { createHttpApp } from "./create-http-app.js";
import { listenOnLoopback } from "./listen.js";
import { loadChatTemplate } from "./chat-page.js";

const config: CarinaConfig = {
  apiKey: undefined,
  model: "gpt-4o-mini",
  modelBaseUrl: "https://api.openai.com/v1",
  token: "test-token",
  port: 18790,
  pack: undefined,
  lang: "zh",
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
  assert.deepEqual(body, { ok: true, name: "carina" });
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
  assert.match(html, /data-i18n="chat.title"/);
  assert.match(html, /data-i18n="chat.send"/);
  assert.match(html, /id="carina-boot"/);
  assert.match(html, /龙骨管家/);
  assert.match(html, /Carina steward/);
  const template = loadChatTemplate();
  const keys = [
    ...template.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(keys.includes("chat.title"));
  assert.ok(keys.includes("chat.placeholder"));
  assert.ok(keys.includes("chat.send"));
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
