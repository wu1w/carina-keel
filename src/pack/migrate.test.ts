import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MockRenderer } from "../render/index.js";
import { NodeType } from "../schema/index.js";
import { executeTool, type ToolContext } from "../tools/index.js";
import { WorldStore } from "../world/index.js";
import {
  createPack,
  exportZip,
  importZip,
  openPack,
  readMarkdown,
} from "./index.js";

/**
 * zh: 故事 B — 带走：export zip 后在另一目录打开，地点、人物、碎花瓶、MEMORY 都在。
 * en: Story B — takeaway: after export zip, another directory still has place, people, vase, MEMORY.
 */

/**
 * zh: 从 spawn 结果取出节点 id。
 * en: Read the spawned node id from a tool result.
 */
function spawnedId(result: { data?: unknown }): string {
  const data = result.data;
  assert.ok(data !== null && typeof data === "object");
  const node = (data as { node?: { id?: unknown } }).node;
  assert.ok(node !== null && typeof node === "object");
  assert.equal(typeof node.id, "string");
  return node.id;
}

/**
 * zh: 种下一座带记忆的酒馆并导出。
 * en: Seed a remembered tavern and return ids.
 */
async function seedAndClose(packDir: string): Promise<{
  placeId: string;
  vaseId: string;
}> {
  const packHandle = await openPack(packDir);
  const store = new WorldStore(packHandle);
  const ctx: ToolContext = {
    store,
    renderer: new MockRenderer(),
    exportZip,
    packHandle,
    lang: "en",
  };
  const placeId = spawnedId(
    await executeTool("spawn", { type: NodeType.Place, name: "Tavern" }, ctx),
  );
  await executeTool("go", { placeId }, ctx);
  const vaseId = spawnedId(
    await executeTool(
      "spawn",
      { type: NodeType.Object, name: "Vase", placeId },
      ctx,
    ),
  );
  await executeTool(
    "remember",
    { fact: "The vase is broken.", relatedNodeIds: [vaseId] },
    ctx,
  );
  return { placeId, vaseId };
}

test("story B export zip then importZip reopens the same world", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "carina-story-b-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const packDir = join(rootDir, "tavern.carina");
  await createPack(packDir, "en");
  const seeded = await seedAndClose(packDir);

  const zipPath = join(rootDir, "tavern.carina.zip");
  const handle = await openPack(packDir);
  await exportZip(handle, zipPath);

  const migratedDir = join(rootDir, "other.carina");
  await importZip(zipPath, migratedDir);
  const migrated = await openPack(migratedDir);
  const store = new WorldStore(migrated);
  assert.equal(migrated.session.placeId, seeded.placeId);
  assert.equal(store.query({ id: seeded.placeId })[0]?.props["name"], "Tavern");
  assert.equal(store.query({ id: seeded.vaseId })[0]?.props["name"], "Vase");
  const memory = await readMarkdown(migrated, "MEMORY.md");
  assert.equal(memory.includes("The vase is broken."), true);
});

test("story B openPack accepts a .carina.zip path", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "carina-story-b-zip-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const packDir = join(rootDir, "source.carina");
  await createPack(packDir, "en");
  const seeded = await seedAndClose(packDir);
  const zipPath = join(rootDir, "harbor.carina.zip");
  await exportZip(await openPack(packDir), zipPath);

  const fromZip = await openPack(zipPath);
  const store = new WorldStore(fromZip);
  assert.equal(fromZip.packDir.endsWith("harbor.carina"), true);
  assert.equal(fromZip.session.placeId, seeded.placeId);
  assert.equal(store.query({ id: seeded.vaseId })[0]?.type, NodeType.Object);
  const memory = await readFile(join(fromZip.packDir, "MEMORY.md"), "utf8");
  assert.equal(memory.includes("The vase is broken."), true);
});
