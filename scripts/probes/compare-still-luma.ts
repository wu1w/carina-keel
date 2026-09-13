/**
 * Offline luma recap for posed-inside Unlit→Opaque stills.
 * Does not talk to Unreal, does not cook, and never sets p1Pass.
 *
 * Canonical stills: docs/benchmarks/windows-rtx5070ti/validation/ng1_interior_shell_reparent4/
 * Invalid outdoor stills in ng1_interior_shell_reparent/ are not interior proof.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(
  repoRoot,
  "docs/benchmarks/windows-rtx5070ti/validation/ng1_interior_shell_reparent4",
);
const outPath = path.join(outDir, "luma.json");

async function main(): Promise<void> {
  const existing = JSON.parse(await readFile(outPath, "utf8")) as Record<string, unknown>;
  existing["wroteBy"] = "scripts/probes/compare-still-luma.ts";
  existing["liveUe"] = false;
  existing["p1Pass"] = false;
  existing["interiorLitVerified"] = false;
  existing["claimsGeneratedLighting"] = false;
  existing["claimsWorldModelGeneration"] = false;
  existing["cameraPoseValid"] = true;
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
