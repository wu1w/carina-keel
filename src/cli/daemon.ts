/**
 * zh: 探测本机 daemon 是否已在端口上。
 * en: Probe whether the local daemon already owns the port.
 */
export async function isDaemonHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) {
      return false;
    }
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) {
      return false;
    }
    return (body as { name?: unknown }).name === "carina";
  } catch {
    return false;
  }
}

/**
 * zh: 等到 SIGINT / SIGTERM。
 * en: Wait until SIGINT / SIGTERM.
 */
export function waitForStopSignal(close?: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const onStop = () => {
      process.off("SIGINT", onStop);
      process.off("SIGTERM", onStop);
      if (close === undefined) {
        resolve();
        return;
      }
      void close().finally(() => resolve());
    };
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);
  });
}
