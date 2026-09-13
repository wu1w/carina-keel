import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jobRecordSchema, type JobKind, type JobPurpose, type JobRecord, type JobStatus } from "../schema/index.js";
import { createUlid, nowIsoUtc } from "../world/ids.js";

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
  mark(
    jobId: string,
    status: JobStatus,
    extra?: Partial<JobRecord>,
  ): JobRecord | undefined;
  list(worldId?: string): JobRecord[];
  reconcile(state: {
    controlEpoch: number;
    headRevision?: string;
  }): JobRecord[];
  isResultApplicable(job: JobRecord, ctx: ApplicabilityContext): boolean;
};

/**
 * zh: 可选把任务记到 dataDir。重启不得把未完成任务当成可提交成功。
 * en: Optional on-disk jobs. Restart must not treat in-flight jobs as committable successes.
 */
export type JobQueueOptions = {
  persistPath?: string;
};

/**
 * zh: 创建任务队列。模拟任务在测试中立即完成。
 * en: Create a job queue. Mock jobs complete immediately in tests.
 */
export function createJobQueue(options: JobQueueOptions = {}): JobQueue {
  const jobs = new Map<string, JobRecord>();
  loadJobs(jobs, options.persistPath);

  function persist(): void {
    persistJobs(jobs, options.persistPath);
  }

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
      persist();
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
      persist();
      return cloneJob(record);
    },

    observe(jobId: string): JobRecord | undefined {
      const record = jobs.get(jobId);
      if (record === undefined) {
        return undefined;
      }
      return cloneJob(record);
    },

    mark(jobId, status, extra) {
      const record = jobs.get(jobId);
      if (record === undefined) {
        return undefined;
      }
      const next: JobRecord = {
        ...record,
        ...extra,
        jobId: record.jobId,
        worldId: extra?.worldId ?? record.worldId,
        status,
        updatedAt: nowIsoUtc(),
      };
      jobs.set(jobId, next);
      persist();
      return cloneJob(next);
    },

    list(worldId) {
      const rows: JobRecord[] = [];
      for (const record of jobs.values()) {
        if (worldId !== undefined && record.worldId !== worldId) {
          continue;
        }
        rows.push(cloneJob(record));
      }
      return rows;
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
      persist();
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

/**
 * zh: 读盘。排队中/运行中的任务标失败，避免重启后当成已生成成功。
 * en: Load from disk. In-flight jobs fail so restart cannot treat them as generated success.
 */
function loadJobs(jobs: Map<string, JobRecord>, persistPath: string | undefined): void {
  if (persistPath === undefined) {
    return;
  }
  let raw: string;
  try {
    raw = readFileSync(persistPath, "utf8");
  } catch {
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(json)) {
    return;
  }
  const now = nowIsoUtc();
  let interrupted = false;
  for (const row of json) {
    const parsed = jobRecordSchema.safeParse(row);
    if (!parsed.success) {
      continue;
    }
    const record = parsed.data;
    if (
      record.status === "queued" ||
      record.status === "running" ||
      record.status === "cancelRequested"
    ) {
      record.status = "failed";
      record.errorKey = "error.jobInterrupted";
      record.updatedAt = now;
      interrupted = true;
    }
    jobs.set(record.jobId, record);
  }
  if (interrupted) {
    persistJobs(jobs, persistPath);
  }
}

/**
 * zh: 原子写入任务文件。
 * en: Atomically write the job file.
 */
function persistJobs(
  jobs: Map<string, JobRecord>,
  persistPath: string | undefined,
): void {
  if (persistPath === undefined) {
    return;
  }
  mkdirSync(path.dirname(persistPath), { recursive: true });
  const tmp = `${persistPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify([...jobs.values()]));
  renameSync(tmp, persistPath);
}
