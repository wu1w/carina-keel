import { serve } from "@hono/node-server";
import type { Hono } from "hono";

/**
 * zh: 本机回环主机名。禁止绑到公网网卡。
 * en: Loopback hostname. Never bind a public interface.
 */
export const LOOPBACK_HOST = "127.0.0.1";

/**
 * zh: 在 127.0.0.1 上监听 HTTP。
 * en: Listen for HTTP on 127.0.0.1.
 */
export async function listenOnLoopback(
  app: Hono,
  port: number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const hostname = LOOPBACK_HOST;
  const bound = await new Promise<{
    close: (callback: (err?: Error) => void) => void;
    port: number;
  }>((resolve, reject) => {
    const instance = serve(
      {
        fetch: app.fetch,
        hostname,
        port,
      },
      (info) => {
        resolve({
          close: (callback) => {
            instance.close(callback);
          },
          port: info.port,
        });
      },
    );
    instance.once("error", reject);
  });
  const url = `http://${hostname}:${bound.port}/`;
  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        bound.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}
