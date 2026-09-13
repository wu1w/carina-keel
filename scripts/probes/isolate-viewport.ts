/**
 * Hide the default Third Person map on the live host without remounting.
 * Visibility cvars only. Not a P1 pass and not generated lighting.
 *
 * Env: CARINA_WORLD_RUNTIME_URL (default http://127.0.0.1:18794).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUeWorldRuntimeClient } from "../../src/runtime/ue-world-runtime-client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "isolate_viewport.json");
const wrUrl = (process.env["CARINA_WORLD_RUNTIME_URL"] ?? "http://127.0.0.1:18794").replace(
  /\/+$/,
  "",
);

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const healthRes = await fetch(`${wrUrl}/health`, { signal: AbortSignal.timeout(8000) });
  const health = (await healthRes.json()) as Record<string, unknown>;
  if (health["live"] !== true || health["hostRemount"] !== true) {
    throw new Error(`WorldRuntime not live: ${JSON.stringify(health)}`);
  }
  const client = createUeWorldRuntimeClient({ url: wrUrl, remount: "none" });
  const isolated = await client.isolateViewport();
  const result = {
    probe: "isolate-viewport",
    at: new Date().toISOString(),
    honesty: {
      note: "isolate_carina + Lit cvars + play-enter pose over IPC. Hides the default Third Person map. Not generated lighting, not a P1 pass, not a world-model room.",
      p1Pass: false,
      claimsGeneratedLighting: false,
      claimsWorldModelGeneration: false,
      interiorLitVerified: false,
    },
    isolate: isolated,
    verdict: {
      isolated: isolated.ok,
      viewmodeLit: isolated.viewmodeLit === true,
      playEnter: isolated.playEnter !== undefined,
      neverClaimsP1: isolated.p1Pass === false && isolated.claimsGeneratedLighting === false,
      p1Pass: false,
    },
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
  if (!result.verdict.isolated) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
