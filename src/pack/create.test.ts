import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CarinaError } from "../errors.js";
import { NodeType } from "../schema/index.js";
import { createPack, listSkills, openPack, readMarkdown } from "./index.js";

/**
 * zh: 建临时目录，测试结束后删掉。
 * en: Make a scratch directory and delete it after the test.
 */
async function withScratchDir(): Promise<{
  scratchDir: string;
  cleanup: () => Promise<void>;
}> {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "carina-pack-"));
  return {
    scratchDir,
    cleanup: async () => {
      await rm(scratchDir, { recursive: true, force: true });
    },
  };
}

test("createPack writes a zh pack that openPack can load", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "tavern.carina");
  await createPack(packDir, "zh");

  const events = await readdir(path.join(packDir, "events"));
  assert.deepEqual(events, []);
  await readdir(path.join(packDir, "assets"));
  await readdir(path.join(packDir, "skills"));

  const handle = await openPack(packDir);
  assert.equal(handle.graph.version, 0);
  assert.equal(handle.graph.nodes.length, 1);
  assert.equal(handle.graph.edges.length, 0);
  const worldNode = handle.graph.nodes[0];
  assert.ok(worldNode);
  assert.equal(worldNode.type, NodeType.World);
  assert.equal(worldNode.props["name"], "tavern");
  assert.equal(worldNode.id.length, 26);
  assert.equal(handle.session.placeId, null);
  assert.equal(handle.session.lastTurnAt, null);
  assert.equal(handle.session.modelId, null);

  const worldMd = await readMarkdown(handle, "WORLD.md");
  assert.match(worldMd, /世界/);
  assert.equal(worldMd.includes("\r"), false);

  const skills = await listSkills(handle);
  assert.deepEqual(skills, ["skills/tavern-continuity/SKILL.md"]);
  const skillMd = await readMarkdown(handle, skills[0] ?? "");
  assert.match(skillMd, /tavern-continuity/);

  const graphText = await readFile(path.join(packDir, "graph.json"), "utf8");
  assert.equal(graphText.includes("\r"), false);
  assert.equal(graphText.endsWith("\n"), true);
});

test("createPack copies en templates", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "harbor.carina");
  await createPack(packDir, "en");
  const handle = await openPack(packDir);
  const worldMd = await readMarkdown(handle, "WORLD.md");
  assert.match(worldMd, /source of truth/);
  assert.equal(worldMd.includes("图谱"), false);
  assert.equal(handle.graph.nodes[0]?.props["name"], "harbor");
});

test("openPack rejects a missing pack", async () => {
  await assert.rejects(
    () =>
      openPack(path.join(os.tmpdir(), "missing-carina-pack-does-not-exist")),
    (error: unknown) =>
      error instanceof CarinaError &&
      error.code === "PACK_NOT_FOUND" &&
      error.messageKey === "error.packNotFound",
  );
});

test("openPack rejects invalid graph.json", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "broken.carina");
  await createPack(packDir, "en");
  await writeFile(path.join(packDir, "graph.json"), "{not json", "utf8");
  await assert.rejects(
    () => openPack(packDir),
    (error: unknown) =>
      error instanceof CarinaError &&
      error.code === "GRAPH_INVALID" &&
      error.messageKey === "error.graphInvalid",
  );
});

test("createPack refuses to overwrite an existing pack", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "once.carina");
  await createPack(packDir, "zh");
  await assert.rejects(
    () => createPack(packDir, "zh"),
    (error: unknown) =>
      error instanceof CarinaError &&
      error.code === "PACK_INVALID" &&
      error.messageKey === "error.packInvalid",
  );
});

test("save writes graph and session atomically", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "keep.carina");
  await createPack(packDir, "en");
  const handle = await openPack(packDir);
  handle.session.placeId = "place_1";
  handle.session.modelId = "gpt-test";
  await handle.save();
  const reopened = await openPack(packDir);
  assert.equal(reopened.session.placeId, "place_1");
  assert.equal(reopened.session.modelId, "gpt-test");
  assert.equal(reopened.session.lastTurnAt, null);
});
