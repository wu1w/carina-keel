import { createUlid, nowIsoUtc } from "../world/ids.js";
import type { WorldEvent } from "../schema/index.js";

const RING = 500;

/**
 * zh: 每世界最近 500 条事件的内存环。
 * en: In-memory ring of the last 500 events per world.
 */
export class WorldEventLog {
  private readonly buffers = new Map<string, WorldEvent[]>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private closed = false;

  /**
   * zh: 追加事件并唤醒订阅者。
   * en: Append an event and wake subscribers.
   */
  emit(
    event: Omit<WorldEvent, "eventId" | "createdAt"> & {
      eventId?: string;
      createdAt?: string;
    },
  ): WorldEvent {
    const full: WorldEvent = {
      eventId: event.eventId ?? createUlid(),
      worldId: event.worldId,
      type: event.type,
      createdAt: event.createdAt ?? nowIsoUtc(),
      payload: event.payload,
      ...(event.revision !== undefined ? { revision: event.revision } : {}),
      ...(event.controlEpoch !== undefined
        ? { controlEpoch: event.controlEpoch }
        : {}),
      ...(event.commandId !== undefined ? { commandId: event.commandId } : {}),
      ...(event.jobId !== undefined ? { jobId: event.jobId } : {}),
    };
    const list = this.buffers.get(full.worldId) ?? [];
    list.push(full);
    while (list.length > RING) {
      list.shift();
    }
    this.buffers.set(full.worldId, list);
    const waiting = this.waiters.get(full.worldId) ?? [];
    this.waiters.set(full.worldId, []);
    for (const wake of waiting) {
      wake();
    }
    return full;
  }

  /**
   * zh: 从 lastEventId 之后续接，然后等待新事件。
   * en: Resume after lastEventId, then wait for new events.
   */
  subscribe(worldId: string, lastEventId?: string): AsyncIterable<WorldEvent> {
    const log = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<WorldEvent> {
        let index = log.startIndex(worldId, lastEventId);
        return {
          async next(): Promise<IteratorResult<WorldEvent>> {
            while (!log.closed) {
              const list = log.buffers.get(worldId) ?? [];
              if (index < list.length) {
                const value = list[index];
                index += 1;
                if (value !== undefined) {
                  return { value, done: false };
                }
              }
              await new Promise<void>((resolve) => {
                const arr = log.waiters.get(worldId) ?? [];
                arr.push(resolve);
                log.waiters.set(worldId, arr);
              });
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  /**
   * zh: 关闭并唤醒所有等待。
   * en: Close and wake every waiter.
   */
  close(): void {
    this.closed = true;
    for (const waiting of this.waiters.values()) {
      for (const wake of waiting) {
        wake();
      }
    }
    this.waiters.clear();
  }

  /**
   * zh: lastEventId 的下一条；找不到则从头放。
   * en: Index after lastEventId; replay from the start if missing.
   */
  private startIndex(worldId: string, lastEventId?: string): number {
    if (lastEventId === undefined) {
      return 0;
    }
    const list = this.buffers.get(worldId) ?? [];
    const found = list.findIndex((event) => event.eventId === lastEventId);
    return found >= 0 ? found + 1 : 0;
  }
}
