/**
 * zh: 异步任务队列。控制命令不进入此队列。
 * en: Asynchronous job queue. Control commands do not enter this queue.
 */
export {
  createJobQueue,
  isResultApplicable,
  type ApplicabilityContext,
  type EnqueueJobInput,
  type JobQueue,
  type JobQueueOptions,
} from "./queue.js";
