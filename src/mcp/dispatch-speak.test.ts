import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import { createApplication } from "../application/create-application.js";
import { normalizeSessionList } from "../server/bind-application.js";
import { dispatchSpeak } from "./dispatch-speak.js";

function testConfig(dataDir: string): CarinaConfig {
  return {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
    allowPrimitiveFixture: true,
  };
}

/**
 * zh: MCP speak 创建世界走 WorldCommand，不写 placeId 八工具图。
 * en: MCP speak creates a world via WorldCommand, not the eight-tool graph.
 */
test("dispatchSpeak creates a world through the application facade", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-mcp-speak-"));
  const app = createApplication(testConfig(dataDir));
  try {
    const spoken = await dispatchSpeak(app, "新建一个酒馆");
    assert.equal(spoken.isError, false);
    assert.equal(spoken.results[0]?.accepted, true);
    assert.ok(spoken.results[0]?.worldId !== undefined);
    const listed = normalizeSessionList(await app.listSessions());
    assert.equal(listed.worlds.length, 1);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
