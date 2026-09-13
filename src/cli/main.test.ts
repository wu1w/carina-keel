import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createPack } from "../pack/index.js";
import { NodeType } from "../schema/index.js";
import { main } from "./main.js";
import { legacyCommand } from "./commands/legacy.js";
import { createToolContext, executeTool } from "./tool-session.js";

const execFileAsync = promisify(execFile);

/**
 * zh: 根命令只挂产品入口；图谱工具在 legacy 下，不在 --help 里冒充产品。
 * en: Root CLI is the product path; graph tools live under legacy and do not impersonate the product.
 */
test("main registers product commands and nests leftover pack tools under legacy", () => {
  const names = Object.keys(main.subCommands ?? {}).sort();
  assert.deepEqual(
    names,
    ["chat", "legacy", "look", "mcp", "new", "remember", "serve", "sessions"].sort(),
  );
  assert.deepEqual(
    Object.keys(legacyCommand.subCommands ?? {}).sort(),
    ["attach", "export", "go", "query", "relate", "say", "spawn"].sort(),
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

/**
 * zh: `carina --help` 产品入口不含 spawn/go。
 * en: `carina --help` lists the product path, not leftover spawn/go.
 */
test("carina help lists product commands not leftover spawn or go", async () => {
  const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", "src/cli/main.ts", "--help"]);
  assert.match(stdout, /\bchat\b/);
  assert.match(stdout, /\blegacy\b/);
  assert.equal(/\bspawn\b/.test(stdout), false);
  assert.equal(/\bgo\b/.test(stdout), false);
});
