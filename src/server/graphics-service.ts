import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Hono } from 'hono';
import type { CarinaConfig } from '../config.js';
import { assetIdSchema, graphicsAssetSchema, MAX_GLB_BYTES, validateGraphicsGlb } from './graphics-assets.js';

/** This boundary reports verified capabilities; connectivity alone never enables a renderer. */
export const graphicsHealthSchema = z.object({
  service: z.string().max(200),
  gpu_name: z.string().max(200),
  vram_mib: z.number().nonnegative().finite(),
  driver: z.string().max(100),
  backend: z.string().max(300),
  ready: z.boolean(),
  capabilities: z.object({
    meshRender: z.boolean(), lumenSW: z.boolean(), lumenHW: z.boolean(),
    dlssSuperResolution: z.boolean(), dlssNeuralRendering: z.boolean(),
    pbrRasterIBL: z.boolean().default(false), pathTraceDXR: z.boolean().default(false),
    falcorPathTrace: z.boolean().default(false),
  }),
});

const jobIdSchema = z.string().regex(/^[a-f0-9]{12}$/);
const vectorSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const cameraSchema = z.object({ eye: vectorSchema, target: vectorSchema, up: vectorSchema }).strict().refine(camera => {
  const forward = camera.target.map((v, i) => v - camera.eye[i]!);
  const up = camera.up;
  const cross = [forward[1]! * up[2] - forward[2]! * up[1], forward[2]! * up[0] - forward[0]! * up[2], forward[0]! * up[1] - forward[1]! * up[0]];
  return Math.hypot(...cross) > 1e-8;
}, 'Camera direction and up must form a valid basis.');
type CameraPose = z.infer<typeof cameraSchema>;
/** The Windows contract consumes one pose per frame; turn keyframes into continuous samples. */
function sampleCameraPath(path: CameraPose[], frames: number): CameraPose[] {
  if (path.length === 1) return Array.from({length: frames}, () => path[0]!);
  return Array.from({length: frames}, (_, frame) => {
    const position = frames === 1 ? 0 : frame * (path.length - 1) / (frames - 1);
    const first = Math.min(Math.floor(position), path.length - 2);
    const fraction = position - first;
    const mix = (field: keyof CameraPose): [number, number, number] => path[first]![field].map((value, axis) =>
      value + (path[first + 1]![field][axis]! - value) * fraction) as [number, number, number];
    return {eye: mix('eye'), target: mix('target'), up: mix('up')};
  });
}
const scenePathSchema = z.string().max(300).regex(/^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.glb$/);
export const graphicsJobRequestSchema = z.object({
  mode: z.enum(['baseline', 'hq_pbr', 'lumen_sw', 'lumen_hw', 'lumen_dlss_nr']),
  resolution: z.union([z.tuple([z.literal(1280), z.literal(720)]), z.tuple([z.literal(1920), z.literal(1080)])]),
  frames: z.number().int().min(1).max(120),
  warmup_frames: z.number().int().min(0).max(60).optional(),
  scene_glb: scenePathSchema.optional(),
  assetId: assetIdSchema.optional(),
  camera_path: z.array(cameraSchema).min(1).max(120).optional(),
}).strict().superRefine((job, context) => {
  if (job.mode === 'hq_pbr' && Number(Boolean(job.scene_glb)) + Number(Boolean(job.assetId)) !== 1) context.addIssue({code:'custom',message:'PBR validation requires exactly one GLB asset reference.',path:['assetId']});
  if (job.mode !== 'hq_pbr' && (job.scene_glb || job.assetId || job.camera_path || job.warmup_frames !== undefined)) context.addIssue({code:'custom',message:'Scene/camera options require the PBR validation mode.'});
  if (job.camera_path && sampleCameraPath(job.camera_path, job.frames).some(pose => !cameraSchema.safeParse(pose).success)) context.addIssue({code:'custom',message:'Interpolated camera path contains an invalid view basis.',path:['camera_path']});
}).transform(job => job.camera_path ? {...job, camera_path: sampleCameraPath(job.camera_path, job.frames)} : job);
const artifactNameSchema = z.string().max(100).regex(/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|mp4|json)$/);
const graphicsJobSchema = z.object({
  id: jobIdSchema, mode: z.string().max(80), resolution: z.tuple([z.number(), z.number()]), frames: z.number().int(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'blocked']),
  progress: z.number().min(0).max(1),
  error: z.string().max(2000).nullable().optional(), reason: z.string().max(2000).nullable().optional(),
  created_at: z.string(), started_at: z.string().nullable(), finished_at: z.string().nullable(),
  artifacts: z.array(artifactNameSchema).max(200),
});

class GraphicsError extends Error {
  constructor(readonly state: 'unconfigured' | 'misconfigured' | 'unauthorized' | 'unavailable' | 'busy' | 'not_found' | 'invalid_request') { super(state); }
}

export function createGraphicsClient(config: CarinaConfig, deps: { fetch?: typeof fetch; readKey?: (file: string) => Promise<string> } = {}) {
  const request = deps.fetch ?? fetch;
  async function upstream(path: string, init: RequestInit = {}, timeoutMs = 4000) {
    if (!config.rtxServiceUrl || !config.rtxServiceKeyFile) throw new GraphicsError('unconfigured');
    let url: URL;
    try { url = new URL(config.rtxServiceUrl); } catch { throw new GraphicsError('misconfigured'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new GraphicsError('misconfigured');
    const key = (await (deps.readKey ?? (file => readFile(file, 'utf8')))(config.rtxServiceKeyFile)).trim();
    if (!key || /[\r\n]/.test(key)) throw new GraphicsError('misconfigured');
    const response = await request(new URL(path, url), {
      ...init, headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GraphicsError(response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'busy' : response.status === 404 ? 'not_found' : [400, 413, 422].includes(response.status) ? 'invalid_request' : 'unavailable');
    }
    return response;
  }
  const failure = (error: unknown) => ({ state: error instanceof GraphicsError ? error.state : 'unavailable' as const });
  async function health() {
    try {
      const start = performance.now();
      const response = await upstream('/health');
      const health = graphicsHealthSchema.parse(await response.json());
      return { state: 'connected' as const, health, roundTripMs: performance.now() - start };
    } catch (error) { return failure(error); }
  }
  async function job(input: z.infer<typeof graphicsJobRequestSchema> | string) {
    try {
      const response = typeof input === 'string'
        ? await upstream(`/jobs/${jobIdSchema.parse(input)}`)
        : await upstream('/jobs', { method: 'POST', body: JSON.stringify(graphicsJobRequestSchema.parse(input)) });
      return { state: 'connected' as const, job: graphicsJobSchema.parse(await response.json()) };
    } catch (error) { return failure(error); }
  }
  async function uploadAsset(bytes: Uint8Array, sourceLabel?: string) {
    let hash: string;
    try {
      hash = validateGraphicsGlb(bytes);
      if (sourceLabel !== undefined && !z.string().max(200).safeParse(sourceLabel).success) throw new Error('INVALID_LABEL');
    } catch { return { state: 'invalid_request' as const }; }
    try {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' }), 'asset.glb');
      if (sourceLabel) form.set('source_label', sourceLabel);
      const response = await upstream('/assets/glb', { method: 'POST', body: form }, 120_000);
      const asset = graphicsAssetSchema.parse(await response.json());
      if (asset.contentHash !== hash || asset.byteLength !== bytes.byteLength) throw new Error('ASSET_MISMATCH');
      return { state: 'connected' as const, asset };
    } catch (error) { return failure(error); }
  }
  async function asset(id: string) {
    if (!assetIdSchema.safeParse(id).success) return { state: 'invalid_request' as const };
    try {
      const response = await upstream(`/assets/${id}`);
      const asset = graphicsAssetSchema.parse(await response.json());
      if (asset.assetId !== id) throw new Error('ASSET_MISMATCH');
      return { state: 'connected' as const, asset };
    } catch (error) { return failure(error); }
  }
  async function artifact(id: string, name: string): Promise<Response> {
    if (!jobIdSchema.safeParse(id).success || !artifactNameSchema.safeParse(name).success) return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
    try {
      const response = await upstream(`/artifacts/${id}/${name}`);
      // Stream with a hard byte limit; never buffer a remote video in the app process.
      const limit = 128 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        return Response.json({ code: 'ARTIFACT_TOO_LARGE' }, { status: 502 });
      }
      let bytes = 0;
      const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > limit) controller.error(new Error('ARTIFACT_TOO_LARGE'));
          else controller.enqueue(chunk);
        },
      }));
      const extension = name.split('.').pop()!;
      const mime: Record<string, string> = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',mp4:'video/mp4',json:'application/json'};
      return new Response(body, {headers: {
        'Content-Type': mime[extension]!, 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="${name}"`,
      }});
    } catch (error) {
      const result = failure(error);
      return Response.json(result, {status: result.state === 'not_found' ? 404 : 503});
    }
  }
  return { health, job, artifact, uploadAsset, asset };
}

/** Mounted behind Carina's existing /v1 authentication. Never sends the Windows credential to the browser. */
export function registerGraphicsRoutes(app: Hono, config: CarinaConfig, deps: Parameters<typeof createGraphicsClient>[1] = {}) {
  const client = createGraphicsClient(config, deps);
  let uploading = false;
  app.post('/v1/graphics/assets/glb', async c => {
    if (uploading) return c.json({ state: 'busy' }, 429);
    uploading = true;
    try {
      const contentType = c.req.header('content-type') ?? '';
      if (!contentType.toLowerCase().startsWith('multipart/form-data;')) return c.json({ code: 'INVALID_REQUEST' }, 400);
      const limit = MAX_GLB_BYTES + 1024 * 1024;
      if (Number(c.req.header('content-length')) > limit) return c.json({ code: 'ASSET_TOO_LARGE' }, 413);
      // Bound the actual stream as well as Content-Length before parsing multipart data.
      const reader = c.req.raw.body?.getReader();
      if (!reader) return c.json({ code: 'INVALID_REQUEST' }, 400);
      const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 120_000);
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > limit) {
            await reader.cancel();
            return c.json({ code: 'ASSET_TOO_LARGE' }, 413);
          }
          chunks.push(next.value);
        }
      } finally { clearTimeout(timer); reader.releaseLock(); }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
      const file = form.get('file');
      const label = form.get('source_label');
      if (!(file instanceof File) || form.getAll('file').length !== 1 || (label !== null && typeof label !== 'string')) return c.json({ code: 'INVALID_REQUEST' }, 400);
      if (file.size > MAX_GLB_BYTES) return c.json({ code: 'ASSET_TOO_LARGE' }, 413);
      const result = await client.uploadAsset(new Uint8Array(await file.arrayBuffer()), label ?? undefined);
      return c.json(result, result.state === 'connected' ? 201 : result.state === 'invalid_request' ? 400 : result.state === 'busy' ? 429 : 503);
    } catch { return c.json({ code: 'INVALID_REQUEST' }, 400); }
    finally { uploading = false; }
  });
  app.get('/v1/graphics/assets/:id', async c => {
    const result = await client.asset(c.req.param('id'));
    return c.json(result, result.state === 'connected' ? 200 : result.state === 'invalid_request' ? 400 : result.state === 'not_found' ? 404 : 503);
  });
  app.get('/v1/graphics/health', async c => c.json(await client.health()));
  // Validation jobs are intentionally separate from the real-time movement loop.
  app.post('/v1/graphics/jobs', async c => {
    const parsed = graphicsJobRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ code: 'INVALID_REQUEST' }, 400);
    const result = await client.job(parsed.data);
    return c.json(result, result.state === 'connected' ? 202 : result.state === 'invalid_request' ? 400 : result.state === 'busy' ? 429 : 503);
  });
  app.get('/v1/graphics/jobs/:id', async c => {
    const parsed = jobIdSchema.safeParse(c.req.param('id'));
    if (!parsed.success) return c.json({ code: 'INVALID_REQUEST' }, 400);
    const result = await client.job(parsed.data);
    return c.json(result, result.state === 'connected' ? 200 : result.state === 'not_found' ? 404 : 503);
  });
  app.get('/v1/graphics/artifacts/:id/:name', c => client.artifact(c.req.param('id'), c.req.param('name')));
}
