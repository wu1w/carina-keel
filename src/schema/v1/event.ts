import { z } from "zod";

/**
 * zh: 会话事件信封。SSE 用 eventId 续接。
 * en: Session event envelope. SSE resumes with eventId.
 */
export const worldEventSchema = z.object({
  eventId: z.string().min(1),
  worldId: z.string().min(1),
  revision: z.string().min(1).optional(),
  controlEpoch: z.number().int().nonnegative().optional(),
  commandId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  type: z.enum([
    "command.accepted",
    "command.rejected",
    "world.paused",
    "world.running",
    "world.stepped",
    "job.progress",
    "job.failed",
    "candidate.ready",
    "world.committed",
    "export.ready",
    "rules.updated",
    "chat.text",
    "observation.ready",
    "runtime.snapshot",
  ]),
  createdAt: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type WorldEvent = z.infer<typeof worldEventSchema>;

/**
 * zh: 运行时权威快照。
 * en: Authoritative runtime snapshot.
 */
export const runtimeSnapshotSchema = z.object({
  worldId: z.string().min(1),
  revision: z.string().min(1),
  controlEpoch: z.number().int().nonnegative(),
  simTime: z.number(),
  runState: z.enum(["running", "paused"]),
  player: z.object({
    position: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    }),
    yaw: z.number(),
    holdingObjectIds: z.array(z.string()),
  }),
  objects: z.array(
    z.object({
      sceneObjectId: z.string().min(1),
      position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      rotationY: z.number(),
      open: z.boolean().optional(),
    }),
  ),
  npcs: z.array(
    z.object({
      sceneObjectId: z.string().min(1),
      position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      goal: z.string().optional(),
    }),
  ),
});

export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;
