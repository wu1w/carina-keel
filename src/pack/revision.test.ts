import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CarinaError } from "../errors.js";
import { createUlid } from "../world/ids.js";
import {
  commitRevision,
  createPack,
  ensureV1,
  openPack,
  readHead,
  readSnapshot,
  readWorldDocuments,
  restoreCheckpoint,
  stageAsset,
  readAsset,
  listCheckpoints,
  updateWorldDocument,
} from "./index.js";

/**
 * zh: 建临时目录，测试结束后删掉。
 * en: Make a scratch directory and delete it after the test.
 */
async function withScratchDir(): Promise<{
  scratchDir: string;
  cleanup: () => Promise<void>;
}> {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "carina-revision-"));
  return {
    scratchDir,
    cleanup: async () => {
      await rm(scratchDir, { recursive: true, force: true });
    },
  };
}

test("ensureV1 on a stripped v0 pack keeps WORLD.md and graph.json bytes", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "tavern.carina");
  await createPack(packDir, "en");
  const graphBefore = await readFile(path.join(packDir, "graph.json"));
  const worldBefore = await readFile(path.join(packDir, "WORLD.md"), "utf8");
  await unlink(path.join(packDir, "HEAD.json"));
  await rm(path.join(packDir, "commits"), { recursive: true, force: true });
  await rm(path.join(packDir, "snapshots"), { recursive: true, force: true });
  await ensureV1(packDir);
  const graphAfter = await readFile(path.join(packDir, "graph.json"));
  assert.deepEqual(graphAfter, graphBefore);
  const worldAfter = await readFile(path.join(packDir, "WORLD.md"), "utf8");
  assert.equal(worldAfter, worldBefore);
  const handle = await openPack(packDir);
  assert.equal(handle.graph.version, 0);
  assert.match(
    await readFile(path.join(packDir, "WORLD.md"), "utf8"),
    /source of truth/,
  );
  const head = await readHead(packDir);
  const snapshot = await readSnapshot(packDir, head.revision);
  assert.equal(snapshot.parentRevision, null);
  assert.equal(snapshot.regions.length, 0);
  assert.equal(snapshot.session.runState, "paused");
  assert.equal(snapshot.session.lifecycle, "active");
  assert.equal(snapshot.session.budgetPolicy.maxAutoJobs, 2);
});

test("commitRevision twice is serialized and HEAD moves", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "serial.carina");
  await createPack(packDir, "en");
  const head = await readHead(packDir);
  const baseline = await readSnapshot(packDir, head.revision);
  const [first, second] = await Promise.all([
    commitRevision({
      packDir,
      worldId: baseline.worldId,
      commandId: createUlid(),
      summary: "First increment",
      mutate: (current) => ({ ...current, simTime: current.simTime + 1 }),
    }),
    commitRevision({
      packDir,
      worldId: baseline.worldId,
      commandId: createUlid(),
      summary: "Second increment",
      mutate: (current) => ({ ...current, simTime: current.simTime + 1 }),
    }),
  ]);
  const afterHead = await readHead(packDir);
  const after = await readSnapshot(packDir, afterHead.revision);
  assert.equal(after.simTime, 2);
  assert.equal(after.revision, afterHead.revision);
  const revisions = new Set([first.revision, second.revision, after.revision]);
  assert.equal(revisions.size, 2);
  assert.ok(after.parentRevision !== null);
  const parent = await readSnapshot(packDir, after.parentRevision);
  assert.equal(parent.simTime, 1);
  assert.equal(parent.parentRevision, baseline.revision);
});

test("restoreCheckpoint copies the target snapshot into a new commit", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "restore.carina");
  await createPack(packDir, "en");
  const head = await readHead(packDir);
  const baseline = await readSnapshot(packDir, head.revision);
  const mid = await commitRevision({
    packDir,
    worldId: baseline.worldId,
    commandId: createUlid(),
    summary: "Move simTime",
    mutate: (current) => ({ ...current, simTime: 5 }),
  });
  const later = await commitRevision({
    packDir,
    worldId: baseline.worldId,
    commandId: createUlid(),
    summary: "Move simTime again",
    mutate: (current) => ({ ...current, simTime: 9 }),
  });
  const restored = await restoreCheckpoint(packDir, mid.revision);
  assert.equal(restored.simTime, 5);
  assert.equal(restored.parentRevision, later.revision);
  assert.notEqual(restored.revision, mid.revision);
  assert.equal(restored.controlEpoch, later.controlEpoch + 1);
  const headAfter = await readHead(packDir);
  assert.equal(headAfter.revision, restored.revision);
  const listed = await listCheckpoints(packDir);
  assert.ok(listed.length >= 3);
  assert.equal(listed[0]?.revision, restored.revision);
  assert.equal(listed[0]?.current, true);
  assert.equal(listed.some((row) => row.revision === mid.revision), true);
  assert.equal(
    listed.filter((row) => row.current).length,
    1,
  );
});

test("stageAsset is content-addressed and updateWorldDocument checks expectedHash", async (t) => {
  const { scratchDir, cleanup } = await withScratchDir();
  t.after(cleanup);
  const packDir = path.join(scratchDir, "assets.carina");
  await createPack(packDir, "en");
  const bytes = new Uint8Array([1, 2, 3, 255]);
  const first = await stageAsset(packDir, bytes, "bin");
  const second = await stageAsset(packDir, bytes, ".bin");
  assert.equal(first.hash, second.hash);
  assert.equal(first.posixPath, `assets/${first.hash}.bin`);
  const stored = await readFile(
    path.join(packDir, ...first.posixPath.split("/")),
  );
  assert.deepEqual([...stored], [1, 2, 3, 255]);

  const readBack = await readAsset(packDir, first.hash, "bin");
  assert.deepEqual([...readBack], [1, 2, 3, 255]);

  const docs = await readWorldDocuments(packDir);
  const world = docs["WORLD.md"];
  assert.ok(world);
  await assert.rejects(
    () => updateWorldDocument(packDir, "WORLD.md", "nope\n", "deadbeef"),
    (error: unknown) =>
      error instanceof CarinaError && error.code === "RULES_INVALID",
  );
  const updated = await updateWorldDocument(
    packDir,
    "WORLD.md",
    `${world.body}\nNo teleport.\n`,
    world.hash,
  );
  const after = await readWorldDocuments(packDir);
  assert.equal(after["WORLD.md"]?.hash, updated.hash);
  assert.match(after["WORLD.md"]?.body ?? "", /No teleport/);
});
