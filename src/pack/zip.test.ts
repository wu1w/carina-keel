import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { unzipSync } from "fflate";
import { createPack, exportZip, openPack, readMarkdown } from "./index.js";

/**
 * zh: 把 zip 解到目录；条目必须是 POSIX 路径。
 * en: Extract a zip into a directory; entries must be POSIX paths.
 */
async function unzipToDirectory(
  zipBytes: Uint8Array,
  destDir: string,
): Promise<string[]> {
  const unzipped = unzipSync(zipBytes);
  const posixPaths = Object.keys(unzipped);
  for (const posixPath of posixPaths) {
    assert.equal(posixPath.includes("\\"), false);
    if (posixPath.includes("..") || posixPath.startsWith("/")) {
      throw new Error(`refusing zip path ${posixPath}`);
    }
    const segments = posixPath
      .split("/")
      .filter((segment) => segment.length > 0);
    if (posixPath.endsWith("/") || segments.length === 0) {
      await mkdir(path.join(destDir, ...segments), { recursive: true });
      continue;
    }
    const absPath = path.join(destDir, ...segments);
    await mkdir(path.dirname(absPath), { recursive: true });
    const data = unzipped[posixPath];
    assert.ok(data);
    await writeFile(absPath, data);
  }
  return posixPaths;
}

test("exportZip round-trips through unzip and openPack", async (t) => {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "carina-zip-"));
  t.after(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });
  const packDir = path.join(scratchDir, "tavern.carina");
  await createPack(packDir, "zh");
  const handle = await openPack(packDir);
  await writeFile(
    path.join(packDir, "assets", "token.bin"),
    Buffer.from([0, 1, 2, 255]),
  );
  handle.session.placeId = "plaza";
  await handle.save();

  const destPath = path.join(scratchDir, "tavern.carina.zip");
  await exportZip(handle, destPath);

  const zipBytes = await readFile(destPath);
  const reopenDir = path.join(scratchDir, "reopened.carina");
  const posixPaths = await unzipToDirectory(zipBytes, reopenDir);
  assert.ok(posixPaths.includes("graph.json"));
  assert.ok(posixPaths.includes("WORLD.md"));
  assert.ok(posixPaths.includes("skills/tavern-continuity/SKILL.md"));
  assert.ok(posixPaths.includes("assets/token.bin"));
  assert.ok(posixPaths.includes("events/") || posixPaths.includes("events"));

  const reopened = await openPack(reopenDir);
  assert.equal(reopened.graph.version, 0);
  assert.equal(reopened.graph.nodes[0]?.props["name"], "tavern");
  assert.equal(reopened.session.placeId, "plaza");
  const worldMd = await readMarkdown(reopened, "WORLD.md");
  assert.match(worldMd, /世界/);
  const token = await readFile(path.join(reopenDir, "assets", "token.bin"));
  assert.deepEqual([...token], [0, 1, 2, 255]);
});
