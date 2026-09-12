import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_GLB_BYTES = 80 * 1024 * 1024;
export const assetIdSchema = z.string().regex(/^[a-f0-9]{16}$/);
export const graphicsAssetSchema = z.object({
  assetId: assetIdSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().min(20).max(MAX_GLB_BYTES),
  deduped: z.boolean().optional(),
}).refine(asset => asset.contentHash.startsWith(asset.assetId), 'Asset identity mismatch');

/** Require a self-contained GLB; resource paths cannot be interpreted on the remote host. */
export function validateGraphicsGlb(bytes: Uint8Array): string {
  if (bytes.byteLength < 20 || bytes.byteLength > MAX_GLB_BYTES) throw new Error('INVALID_GLB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new Error('INVALID_GLB');
  let offset = 12;
  let index = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error('INVALID_GLB');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > bytes.byteLength) throw new Error('INVALID_GLB');
    if (index === 0) {
      if (type !== 0x4e4f534a) throw new Error('INVALID_GLB');
      const document: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 8, offset + 8 + length)));
      const root = z.object({ asset: z.object({ version: z.literal('2.0') }) }).safeParse(document);
      if (!root.success) throw new Error('INVALID_GLB');
      const pending: unknown[] = [document];
      while (pending.length) {
        const value = pending.pop();
        if (value && typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) {
            if (key === 'uri' && (typeof item !== 'string' || !item.startsWith('data:'))) throw new Error('EXTERNAL_GLB_RESOURCE');
            if (item && typeof item === 'object') pending.push(item);
          }
        }
      }
    } else if (index !== 1 || type !== 0x004e4942) throw new Error('INVALID_GLB');
    offset += 8 + length;
    index++;
  }
  return createHash('sha256').update(bytes).digest('hex');
}
