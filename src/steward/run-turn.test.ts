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
