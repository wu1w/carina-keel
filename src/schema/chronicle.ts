import { z } from "zod";

/**
 * zh: 编年 jsonl 一行。文件是日志；图是投影。
 * en: One chronicle jsonl line. The file is the log; the graph is a projection.
 */
export const chronicleEventSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().min(1),
  kind: z.string().min(1),
  actorId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  relatedNodeIds: z.array(z.string()),
});

/**
 * zh: 编年事件类型。
 * en: Chronicle event type.
 */
export type ChronicleEvent = z.infer<typeof chronicleEventSchema>;
