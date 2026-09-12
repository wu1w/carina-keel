import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPack } from "../pack/index.js";
import { NodeType } from "../schema/index.js";
import { main } from "./main.js";
import { createToolContext, executeTool } from "./tool-session.js";

/**
 * zh: 根命令挂上八工具对应的离线 CLI。
 * en: Root command exposes offline CLIs for the eight world tools.
 */
test("main registers look go say remember attach alongside pack commands", () => {
  const names = Object.keys(main.subCommands ?? {}).sort();
  assert.deepEqual(
    names,
    [
      "attach",
      "chat",
      "export",
      "go",
      "look",
      "mcp",
      "new",
      "query",
      "relate",
      "remember",
      "say",
      "serve",
      "sessions",
      "spawn",
    ].sort(),
  );
});

/**
 * zh: CLI 直连路径能 look / go / say / remember / attach，杀进程后仍在。
 * en: The CLI direct path can look / go / say / remember / attach; state survives reopen.
 */
test("cli tool-session persists look go say remember attach", async (t) => {
  const scratchDir = await mkdtemp(join(tmpdir(), "carina-cli-"));
  t.after(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });
  const packDir = join(scratchDir, "tavern.carina");
  await createPack(packDir, "en");
  const ctx = await createToolContext(packDir, "en");

  const spawnedPlace = await executeTool(
    "spawn",
    { type: NodeType.Place, name: "Tavern" },
    ctx,
  );
  const place = (spawnedPlace.data as { node: { id: string } }).node;
  await executeTool("go", { placeId: place.id }, ctx);

  const spawnedKeeper = await executeTool(
    "spawn",
    { type: NodeType.Entity, name: "Mira", placeId: place.id },
    ctx,
  );
  const keeper = (spawnedKeeper.data as { node: { id: string } }).node;
  const said = await executeTool(
    "say",
    { entityId: keeper.id, text: "My name is William." },
    ctx,
  );
  assert.equal(said.ok, true);

  const remembered = await executeTool(
    "remember",
    {
      fact: "The guest is called William.",
      relatedNodeIds: [keeper.id],
    },
    ctx,
  );
  assert.equal(remembered.ok, true);

  await writeFile(join(packDir, "assets", "vase-note.txt"), "broken\n", "utf8");
  const attached = await executeTool(
    "attach",
    {
      nodeId: place.id,
      posixPath: "assets/vase-note.txt",
      kind: "note",
    },
    ctx,
  );
  assert.equal(attached.ok, true);

  const looked = await executeTool("look", {}, ctx);
  assert.equal(looked.ok, true);
  const media = (looked.data as { media: string }).media;
  assert.match(media, new RegExp(place.id));
  assert.match(media, /Mira/);

  const reopened = await createToolContext(packDir, "en");
  assert.equal(reopened.packHandle.session.placeId, place.id);
  assert.equal(reopened.store.query({ type: NodeType.Claim }).length > 0, true);
  assert.equal(reopened.store.query({ type: NodeType.Asset }).length > 0, true);
});
