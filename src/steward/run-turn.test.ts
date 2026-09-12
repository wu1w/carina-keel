import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CarinaError } from "../errors.js";
import { createPack, openPack } from "../pack/index.js";
import { WorldStore } from "../world/index.js";
import { runTurn } from "./run-turn.js";

/**
 * zh: 没有 API Key 时 runTurn 抛 CONFIG。
 * en: runTurn throws CONFIG without an API key.
 */
test("runTurn throws CONFIG when the API key is missing", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "carina-turn-config-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const packDir = join(rootDir, "tavern.carina");
  await createPack(packDir, "zh");
  const pack = await openPack(packDir);
  const store = new WorldStore(pack);

  const iter = runTurn("hello", {
    store,
    pack,
    config: {
      apiKey: undefined,
      model: "gpt-4o-mini",
      modelBaseUrl: "https://api.openai.com/v1",
      token: "dev-token",
      port: 18790,
      pack: packDir,
      lang: "zh",
      dataDir: packDir,
    },
  });

  await assert.rejects(
    async () => {
      for await (const delta of iter) {
        void delta;
      }
    },
    (error: unknown) =>
      error instanceof CarinaError && error.code === "CONFIG",
  );
});

/**
 * zh: 模型失败前已把用户发言写入编年，杀进程再打开仍在。
 * en: The user utterance is chronicled before the model runs and survives reopen.
 */
test("runTurn writes the user utterance before the model fails", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "carina-turn-utterance-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const packDir = join(rootDir, "tavern.carina");
  await createPack(packDir, "en");
  const pack = await openPack(packDir);
  const store = new WorldStore(pack);
  const failingFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ error: { message: "nope" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };

  const iter = runTurn("The vase shattered last night.", {
    store,
    pack,
    fetch: failingFetch,
    config: {
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      modelBaseUrl: "https://api.openai.com/v1",
      token: "dev-token",
      port: 18790,
      pack: packDir,
      lang: "en",
      dataDir: packDir,
    },
  });

  await assert.rejects(
    async () => {
      for await (const delta of iter) {
        void delta;
      }
    },
    (error: unknown) =>
      error instanceof CarinaError && error.code === "INTERNAL",
  );

  const eventsDir = join(packDir, "events");
  const files = await readdir(eventsDir);
  assert.ok(files.some((name) => name.endsWith(".jsonl")));
  const texts: string[] = [];
  for (const name of files) {
    if (name.endsWith(".jsonl")) {
      texts.push(await readFile(join(eventsDir, name), "utf8"));
    }
  }
  const joined = texts.join("\n");
  assert.equal(joined.includes("The vase shattered last night."), true);
  assert.equal(joined.includes('"role":"user"'), true);
  assert.equal(joined.includes("utterance"), true);
});

/**
 * zh: 把 OpenAI 兼容的 SSE 块编成 Response。
 * en: Encode OpenAI-compatible SSE chunks as a Response.
 */
function chatCompletionStream(text: string): Response {
  const payload = JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: text },
        finish_reason: null,
      },
    ],
  });
  const stop = JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-4o-mini",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  const body = `data: ${payload}\n\ndata: ${stop}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * zh: mock 模型成功时产出文本，并写下管家发言与 lastTurnAt。
 * en: A successful mock model yields text and persists the steward utterance and lastTurnAt.
 */
test("runTurn streams mock model text and persists the assistant utterance", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "carina-turn-ok-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const packDir = join(rootDir, "tavern.carina");
  await createPack(packDir, "en");
  const pack = await openPack(packDir);
  const store = new WorldStore(pack);
  const reply = "You are still in the tavern. The vase is broken.";
  const mockFetch: typeof fetch = async () => chatCompletionStream(reply);

  const chunks: string[] = [];
  for await (const event of runTurn("Where am I?", {
    store,
    pack,
    fetch: mockFetch,
    config: {
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      modelBaseUrl: "https://api.openai.com/v1",
      token: "dev-token",
      port: 18790,
      pack: packDir,
      lang: "en",
      dataDir: packDir,
    },
  })) {
    if (event.type === "text") {
      chunks.push(event.text);
    }
  }

  assert.equal(chunks.join(""), reply);
  const eventsDir = join(packDir, "events");
  const files = await readdir(eventsDir);
  const texts: string[] = [];
  for (const name of files) {
    if (name.endsWith(".jsonl")) {
      texts.push(await readFile(join(eventsDir, name), "utf8"));
    }
  }
  const joined = texts.join("\n");
  assert.equal(joined.includes("Where am I?"), true);
  assert.equal(joined.includes(reply), true);
  assert.equal(joined.includes('"role":"assistant"'), true);

  const reopened = await openPack(packDir);
  assert.equal(typeof reopened.session.lastTurnAt, "string");
  assert.equal(reopened.session.modelId, "gpt-4o-mini");
});
