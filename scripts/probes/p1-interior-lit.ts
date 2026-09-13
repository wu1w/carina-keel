/**
 * Dump the control-plane interior visibility cvar spec.
 * Isolate/shoot paths now exec these via IPC highresshot; this probe still
 * does not talk to Unreal, does not scp, and does not claim the interior is lit.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const wrDir = path.join(repoRoot, "runtimes/unreal/world_runtime");
const outDir = path.join(
  repoRoot,
  "docs/benchmarks/windows-rtx5070ti/validation/p1_interior_lit",
);
const outPath = path.join(outDir, "spec.json");

async function main(): Promise<void> {
  const dumped = execFileSync("python3", ["carina_light.py"], {
    cwd: wrDir,
    encoding: "utf-8",
  });
  const spec = JSON.parse(dumped) as Record<string, unknown>;
  spec["wroteBy"] = "scripts/probes/p1-interior-lit.ts";
  spec["liveUe"] = false;
  spec["scp"] = false;
  spec["interiorLitVerified"] = false;
  spec["p1Pass"] = false;
  spec["notWorldModel"] = true;
  spec["claimsWorldModelGeneration"] = false;
  spec["claimsGeneratedLighting"] = false;
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
