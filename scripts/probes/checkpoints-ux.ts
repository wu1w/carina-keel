/**
 * List and restore checkpoints over the product HTTP surface.
 *
 * Env: CARINA_URL (default http://127.0.0.1:18790),
 *      CARINA_TOKEN (default dev-token),
 *      NG1_PACK_WORLD (default 01M2B71PMCBJP585C4F4Z2N400).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "docs/benchmarks/windows-rtx5070ti/validation");
const outPath = path.join(outDir, "checkpoints_ux.json");
const baseUrl = (process.env["CARINA_URL"] ?? "http://127.0.0.1:18790").replace(/\/+$/, "");
const token = process.env["CARINA_TOKEN"] ?? "dev-token";
const packWorldId = process.env["NG1_PACK_WORLD"] ?? "01M2B71PMCBJP585C4F4Z2N400";

type CheckpointRow = {
  revision: string;
  parentRevision?: string | null;
  createdAt?: string;
  summary?: string;
  current?: boolean;
};

async function api(
  pathname: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { text: text.slice(0, 300) } };
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const listed = await api("/v1/sessions");
  const worlds = (listed.body["worlds"] as Array<{ worldId?: string; name?: string }> | undefined) ?? [];
  const worldId =
    worlds.find((world) => world.worldId === packWorldId)?.worldId ?? worlds[0]?.worldId;
  if (worldId === undefined) {
    throw new Error(`no world in ${baseUrl}: ${JSON.stringify(listed.body)}`);
  }
  const opened = await api(`/v1/sessions/${encodeURIComponent(worldId)}/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const before = await api(`/v1/sessions/${encodeURIComponent(worldId)}/checkpoints`);
  const checkpoints = (before.body["checkpoints"] as CheckpointRow[] | undefined) ?? [];
  const currentRevision = String(before.body["currentRevision"] ?? "");
  const parent = checkpoints.find((row) => row.current !== true && row.revision !== currentRevision);
  let restored: { status: number; body: Record<string, unknown> } | undefined;
  let after: { status: number; body: Record<string, unknown> } | undefined;
  if (parent !== undefined) {
    restored = await api(`/v1/sessions/${encodeURIComponent(worldId)}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentKind: "world.restore",
        arguments: { revision: parent.revision },
      }),
    });
    after = await api(`/v1/sessions/${encodeURIComponent(worldId)}/checkpoints`);
  }
  const afterRows = (after?.body["checkpoints"] as CheckpointRow[] | undefined) ?? [];
  const currentAfter = String(after?.body["currentRevision"] ?? "");
  const result = {
    probe: "checkpoints-ux",
    at: new Date().toISOString(),
    honesty: {
      note: "HTTP list + restore of pack revisions. Browser panel is verified separately. Not a 10-minute naive-user A9 pass.",
    },
    url: baseUrl,
    worldId,
    listedWorlds: worlds.map((world) => ({ worldId: world.worldId, name: world.name })),
    openStatus: opened.status,
    before: {
      currentRevision,
      count: checkpoints.length,
      summaries: checkpoints.map((row) => ({
        revision: row.revision,
        summary: row.summary ?? "",
        current: row.current === true,
      })),
    },
    restore: parent
      ? {
          target: parent.revision,
          accepted: restored?.status === 200 && restored.body["accepted"] !== false,
          httpStatus: restored?.status,
          currentRevision: currentAfter,
          count: afterRows.length,
        }
      : { skipped: true },
    verdict: {
      listed: checkpoints.length >= 1,
      panelPayload:
        before.status === 200 &&
        typeof before.body["currentRevision"] === "string" &&
        checkpoints.length >= 1,
      restored:
        parent === undefined
          ? false
          : restored?.status === 200 && currentAfter.length > 0,
    },
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
  if (!result.verdict.listed || !result.verdict.panelPayload) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
