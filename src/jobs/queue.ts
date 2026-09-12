import { createUlid, nowIsoUtc } from "../world/ids.js";
import type { JobKind, JobPurpose, JobRecord } from "../schema/index.js";

/**
 * zh: 判断任务结果是否仍可作用于当前世界。
 * en: Whether a job result may still apply to the current world.
 */
export type ApplicabilityContext = {
  controlEpoch: number;
  headRevision: string;
  readSet: JobRecord["readSet"];
};

/**
 * zh: 入队参数。默认立即完成（无 GPU）。
 * en: Enqueue input. Completes immediately by default (no GPU).
 */
export type EnqueueJobInput = {
  worldId: string;
  kind?: JobKind;
  purpose: JobPurpose;
  baseRevision: string;
  readSet: JobRecord["readSet"];
  controlEpoch: number;
  resultRefs?: string[];
  autoComplete?: boolean;
  providerJobId?: string;
};

/**
 * zh: 本机任务队列：限额之外的取消、过期与 readSet 校验。
 * en: Local job queue: cancel, staleness, and readSet checks (no GPU).
 */
export type JobQueue = {
  enqueue(input: EnqueueJobInput): JobRecord;
  cancel(jobId: string): JobRecord;
  observe(jobId: string): JobRecord | undefined;
  reconcile(state: {
    controlEpoch: number;
    headRevision?: string;
  }): JobRecord[];
  isResultApplicable(job: JobRecord, ctx: ApplicabilityContext): boolean;
};

/**
 * zh: 创建任务队列。模拟任务在测试中立即完成。
 * en: Create a job queue. Mock jobs complete immediately in tests.
 */
export function createJobQueue(): JobQueue {
  const jobs = new Map<string, JobRecord>();

  return {
    enqueue(input: EnqueueJobInput): JobRecord {
      const now = nowIsoUtc();
      const autoComplete = input.autoComplete !== false;
      const record: JobRecord = {
        jobId: createUlid(),
        worldId: input.worldId,
        kind: input.kind ?? "generation",
        purpose: input.purpose,
        baseRevision: input.baseRevision,
        readSet: cloneReadSet(input.readSet),
        controlEpoch: input.controlEpoch,
        status: autoComplete ? "succeeded" : "queued",
        progress: autoComplete ? 1 : 0,
        cancelCapability: autoComplete ? "stop_commit" : "stop_compute",
        attempt: autoComplete ? 1 : 0,
        budgetUsed: {
          seconds: autoComplete ? 0 : 0,
          attempts: autoComplete ? 1 : 0,
        },
        resultRefs: input.resultRefs ?? [],
        createdAt: now,
        updatedAt: now,
      };
      if (input.providerJobId !== undefined) {
        record.providerJobId = input.providerJobId;
      }
      jobs.set(record.jobId, record);
      return cloneJob(record);
    },

    cancel(jobId: string): JobRecord {
      const record = jobs.get(jobId);
      if (record === undefined) {
        const now = nowIsoUtc();
        return {
          jobId,
          worldId: "",
          kind: "generation",
          purpose: "edit",
          baseRevision: "",
          readSet: { regionRevisions: {}, objectVersions: {} },
          controlEpoch: 0,
          status: "failed",
          progress: 0,
          cancelCapability: "none",
          attempt: 0,
          budgetUsed: { seconds: 0, attempts: 0 },
          resultRefs: [],
          errorKey: "error.notFound",
          createdAt: now,
          updatedAt: now,
        };
      }
      if (
        record.status === "queued" ||
        record.status === "running" ||
        record.status === "cancelRequested"
      ) {
        record.status = "cancelled";
        record.cancelCapability = "stop_compute";
        record.updatedAt = nowIsoUtc();
      } else if (record.status === "succeeded") {
        record.cancelCapability = "stop_commit";
        record.updatedAt = nowIsoUtc();
      }
      return cloneJob(record);
    },

    observe(jobId: string): JobRecord | undefined {
      const record = jobs.get(jobId);
      if (record === undefined) {
        return undefined;
      }
      return cloneJob(record);
    },

    reconcile(state: {
      controlEpoch: number;
      headRevision?: string;
    }): JobRecord[] {
      for (const record of jobs.values()) {
        if (record.purpose !== "simulation") {
          continue;
        }
        if (record.status !== "queued" && record.status !== "running" && record.status !== "succeeded") {
          continue;
        }
        const epochMismatch = record.controlEpoch !== state.controlEpoch;
        const revisionMismatch =
          state.headRevision !== undefined &&
          record.baseRevision !== state.headRevision;
        if (epochMismatch || revisionMismatch) {
          record.status = "stale";
          record.updatedAt = nowIsoUtc();
        }
      }
      return [...jobs.values()].map(cloneJob);
    },

    isResultApplicable(job: JobRecord, ctx: ApplicabilityContext): boolean {
      return isResultApplicable(job, ctx);
    },
  };
}

/**
 * zh: 仿真任务在暂停后过期；编辑/导出只要 readSet 仍匹配即可提交。
 * en: Simulation jobs go stale after pause; edit/export may apply if the readSet still matches.
 */
export function isResultApplicable(
  job: JobRecord,
  ctx: ApplicabilityContext,
): boolean {
  if (job.status !== "succeeded") {
    return false;
  }
  if (job.purpose === "simulation") {
    if (job.controlEpoch !== ctx.controlEpoch) {
      return false;
    }
    if (job.baseRevision !== ctx.headRevision) {
      return false;
    }
  }
  return readSetMatches(job.readSet, ctx.readSet);
}

/**
 * zh: 任务读集是否仍等于当前世界版本。
 * en: Whether the job read set still matches current world versions.
 */
function readSetMatches(
  jobSet: JobRecord["readSet"],
  current: JobRecord["readSet"],
): boolean {
  for (const [regionId, revision] of Object.entries(jobSet.regionRevisions)) {
    if (current.regionRevisions[regionId] !== revision) {
      return false;
    }
  }
  for (const [objectId, version] of Object.entries(jobSet.objectVersions)) {
    if (current.objectVersions[objectId] !== version) {
      return false;
    }
  }
  return true;
}

/**
 * zh: 拷贝任务，避免外面对内存储的原地修改。
 * en: Clone a job so callers cannot mutate the store in place.
 */
function cloneJob(record: JobRecord): JobRecord {
  return structuredClone(record);
}

/**
 * zh: 拷贝读集。
 * en: Clone a read set.
 */
function cloneReadSet(readSet: JobRecord["readSet"]): JobRecord["readSet"] {
  return structuredClone(readSet);
}
