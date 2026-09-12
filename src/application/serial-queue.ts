/**
 * zh: 单写队列。同一时刻只跑一个任务。
 * en: Serial write queue. Only one task runs at a time.
 */
export class SerialQueue {
  private chain: Promise<void> = Promise.resolve();

  /**
   * zh: 串行执行。前一个失败不挡住后一个。
   * en: Run serially. A previous failure does not block the next task.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
