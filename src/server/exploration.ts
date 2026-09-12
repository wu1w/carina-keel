import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Application } from "./bind-application.js";
import type { CarinaConfig } from "../config.js";
import { stillBytesFromObservation } from "../application/observe.js";
import { sha256Hex } from "../pack/hash.js";

export const explorationSchema = z.object({
  schemaVersion: z.literal(1), quality: z.literal("estimated-single-view"),
  imageHash: z.string().regex(/^[a-f0-9]{64}$/),
  image: z.object({ mime: z.enum(["image/jpeg", "image/png", "image/webp"]), base64: z.string().max(16_000_000) }),
  width: z.number().int().min(2).max(240), height: z.number().int().min(2).max(240),
  aspect: z.number().positive().max(8),
  depth: z.array(z.number().finite().positive().max(1000)).max(57600),
}).refine(value => value.depth.length === value.width * value.height);
const cameraSchema = z.object({
  position: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
  yaw: z.number().finite(), pitch: z.number().finite(),
  fovY: z.number().positive().max(3), aspect: z.number().positive(),
});
export const cachedSchema = explorationSchema.and(z.object({ captureCamera: cameraSchema }));
export type ExplorationSurface = z.infer<typeof cachedSchema>;

/** Cached derived visual surface. Never promotes estimated depth into collision truth. */
export function createExplorationLoader(config: CarinaConfig) {
  const pending = new Map<string, Promise<ExplorationSurface>>();
  async function load(bound: Application, worldId: string) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(worldId)) throw new Error("Invalid world");
    const map = await bound.getCommittedMap(worldId); // validates session before disk access
    let still = stillBytesFromObservation(bound.getObservation?.(worldId));
    if (still === undefined && bound.hydrateObservation) {
      still = stillBytesFromObservation(await bound.hydrateObservation(worldId));
    }
    if (!still && map.texture) {
      for (const ext of ["jpg", "png", "webp"]) {
        try { still = await bound.readPackAsset(worldId, map.texture.hash, ext); break; }
        catch { /* Try the actual asset extension. */ }
      }
    }
    const hash = still ? sha256Hex(still.bytes) : undefined;
    const dir = path.join(config.dataDir, "exploration", worldId);
    const file = path.join(dir, "surface.json");
    let cached;
    try { cached = cachedSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
    catch { /* Missing or obsolete cache. */ }
    if (cached && (!hash || cached.imageHash === hash)) {
      return cached;
    }
    if (!config.depthUrl) throw new Error("Depth service is not configured");
    const response = await fetch(new URL(still ? "/reconstruct" : "/world/" + worldId, config.depthUrl), {
      ...(still ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ base64: Buffer.from(still.bytes).toString("base64") }) } : {}),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error("No reconstructed view available");
    const surface = explorationSchema.parse(await response.json());
    if (hash && surface.imageHash !== hash) throw new Error("Mismatched reconstruction");
    await mkdir(dir, { recursive: true });
    const result = { ...surface, captureCamera: map.captureCamera };
    await writeFile(file + ".tmp", JSON.stringify(result));
    await rename(file + ".tmp", file);
    return result;
  }
  return (bound: Application, worldId: string) => {
    const existing = pending.get(worldId);
    if (existing) return existing;
    const task = load(bound, worldId).finally(() => pending.delete(worldId));
    pending.set(worldId, task);
    return task;
  };
}
