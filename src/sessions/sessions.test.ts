import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  commitRevision,
  createPack,
  ensureV1,
  openPack,
  readHead,
  readSnapshot,
  readWorldDocuments,
  updateWorldDocument,
} from "../pack/index.js";
import { createUlid } from "../world/ids.js";
import {
  createSession,
  getActiveWorldId,
  listSessions,
  readGlobalProfile,
  switchSession,
  updateGlobalDocument,
} from "./index.js";

/**
 * zh: 建临时数据目录，测试结束后删掉。
 * en: Make a scratch data directory and delete it after the test.
 */
async function withDataDir(): Promise<{
  dataDir: string;
  cleanup: () => Promise<void>;
}> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "carina-sessions-"));
  return {
    dataDir,
    cleanup: async () => {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("create two worlds, switch, list, and active pointer", async (t) => {
  const { dataDir, cleanup } = await withDataDir();
  t.after(cleanup);
  const tavern = await createSession({
    dataDir,
    lang: "zh",
    name: "Tavern",
  });
  const station = await createSession({
    dataDir,
    lang: "zh",
    name: "Station",
  });
  assert.notEqual(tavern.sessionId, station.sessionId);
  assert.equal(await getActiveWorldId(dataDir), station.sessionId);
  const listed = await listSessions(dataDir);
  assert.equal(listed.length, 2);
  const names = new Set(listed.map((row) => row.name));
  assert.ok(names.has("Tavern"));
  assert.ok(names.has("Station"));
  for (const row of listed) {
    assert.ok(row.packDir.length > 0);
  }
  const switched = await switchSession(dataDir, tavern.sessionId);
  assert.equal(switched.sessionId, tavern.sessionId);
  assert.equal(switched.lifecycle, "active");
  assert.equal(await getActiveWorldId(dataDir), tavern.sessionId);
  const afterSwitch = await listSessions(dataDir);
  const stationRow = afterSwitch.find(
    (row) => row.sessionId === station.sessionId,
  );
  assert.ok(stationRow);
  assert.equal(stationRow.lifecycle, "suspended");
  assert.equal(stationRow.runState, "paused");
});

test("global IDENTITY update does not appear in either MEMORY.md", async (t) => {
  const { dataDir, cleanup } = await withDataDir();
  t.after(cleanup);
  const tavern = await createSession({ dataDir, lang: "zh", name: "Tavern" });
  const station = await createSession({ dataDir, lang: "zh", name: "Station" });
  const { documents } = await readGlobalProfile(dataDir, "zh");
  const identity = documents["IDENTITY.md"];
  assert.ok(identity);
  const marker = "Call me William across every world.";
  await updateGlobalDocument(
    dataDir,
    "IDENTITY.md",
    `${identity}\n${marker}\n`,
  );
  const listed = await listSessions(dataDir);
  const tavernRow = listed.find((row) => row.sessionId === tavern.sessionId);
  const stationRow = listed.find((row) => row.sessionId === station.sessionId);
  assert.ok(tavernRow);
  assert.ok(stationRow);
  const tavernDocs = await readWorldDocuments(tavernRow.packDir);
  const stationDocs = await readWorldDocuments(stationRow.packDir);
  assert.equal(tavernDocs["MEMORY.md"]?.body.includes(marker), false);
  assert.equal(stationDocs["MEMORY.md"]?.body.includes(marker), false);
  const profileAfter = await readGlobalProfile(dataDir, "zh");
  assert.equal(profileAfter.documents["IDENTITY.md"]?.includes(marker), true);
});

test("WORLD.md update in world A does not change world B", async (t) => {
  const { dataDir, cleanup } = await withDataDir();
  t.after(cleanup);
  const tavern = await createSession({ dataDir, lang: "zh", name: "Tavern" });
  const station = await createSession({ dataDir, lang: "zh", name: "Station" });
  const listed = await listSessions(dataDir);
  const tavernRow = listed.find((row) => row.sessionId === tavern.sessionId);
  const stationRow = listed.find((row) => row.sessionId === station.sessionId);
  assert.ok(tavernRow);
  assert.ok(stationRow);
  const tavernDocs = await readWorldDocuments(tavernRow.packDir);
  const world = tavernDocs["WORLD.md"];
  assert.ok(world);
  const clause = "晚上十点打烊，禁止瞬移。";
  await updateWorldDocument(
    tavernRow.packDir,
    "WORLD.md",
    `${world.body}\n${clause}\n`,
    world.hash,
  );
  const tavernAfter = await readWorldDocuments(tavernRow.packDir);
  const stationAfter = await readWorldDocuments(stationRow.packDir);
  assert.equal(tavernAfter["WORLD.md"]?.body.includes(clause), true);
  assert.equal(stationAfter["WORLD.md"]?.body.includes(clause), false);
});

test("reopen after process (new listSessions) restores registry", async (t) => {
  const { dataDir, cleanup } = await withDataDir();
  t.after(cleanup);
  const tavern = await createSession({ dataDir, lang: "en", name: "Tavern" });
  await createSession({ dataDir, lang: "en", name: "Station" });
  await switchSession(dataDir, tavern.sessionId);
  const restored = await listSessions(dataDir);
  assert.equal(restored.length, 2);
  assert.equal(await getActiveWorldId(dataDir), tavern.sessionId);
  const names = restored.map((row) => row.name).sort();
  assert.deepEqual(names, ["Station", "Tavern"]);
});

test("commitRevision twice is serialized and HEAD moves", async (t) => {
  const { dataDir, cleanup } = await withDataDir();
  t.after(cleanup);
  const tavern = await createSession({ dataDir, lang: "en", name: "Tavern" });
  const listed = await listSessions(dataDir);
  const row = listed.find((item) => item.sessionId === tavern.sessionId);
  assert.ok(row);
  const head = await readHead(row.packDir);
  const baseline = await readSnapshot(row.packDir, head.revision);
  await Promise.all([
    commitRevision({
      packDir: row.packDir,
      worldId: baseline.worldId,
      commandId: createUlid(),
      summary: "First increment",
      mutate: (current) => ({ ...current, simTime: current.simTime + 1 }),
    }),
    commitRevision({
      packDir: row.packDir,
      worldId: baseline.worldId,
      commandId: createUlid(),
      summary: "Second increment",
      mutate: (current) => ({ ...current, simTime: current.simTime + 1 }),
    }),
  ]);
  const afterHead = await readHead(row.packDir);
  const after = await readSnapshot(row.packDir, afterHead.revision);
  assert.equal(after.simTime, 2);
  assert.ok(after.parentRevision !== null);
});

test("v0 pack from createPack then ensureV1/openPack still has WORLD.md and graph", async (t) => {
  const { dataDir, cleanup } = await withDataDir();
  t.after(cleanup);
  const packDir = path.join(dataDir, "legacy.carina");
  await createPack(packDir, "en");
  const graphBefore = await readFile(path.join(packDir, "graph.json"), "utf8");
  await unlink(path.join(packDir, "HEAD.json"));
  await rm(path.join(packDir, "commits"), { recursive: true, force: true });
  await rm(path.join(packDir, "snapshots"), { recursive: true, force: true });
  await ensureV1(packDir);
  const handle = await openPack(packDir);
  assert.equal(handle.graph.version, 0);
  assert.equal(handle.graph.nodes.length, 1);
  const graphAfter = await readFile(path.join(packDir, "graph.json"), "utf8");
  assert.equal(graphAfter, graphBefore);
  const worldMd = await readFile(path.join(packDir, "WORLD.md"), "utf8");
  assert.match(worldMd, /source of truth/);
});

test("importing the same packDir returns the existing world", async (t) => {
  const { dataDir, cleanup } = await withDataDir();
  t.after(cleanup);
  const packDir = path.join(dataDir, "shared.carina");
  const first = await createSession({
    dataDir,
    lang: "en",
    name: "Shared",
    packDir,
  });
  const second = await createSession({
    dataDir,
    lang: "en",
    name: "Shared copy",
    packDir,
  });
  assert.equal(second.sessionId, first.sessionId);
  const listed = await listSessions(dataDir);
  assert.equal(listed.length, 1);
});
