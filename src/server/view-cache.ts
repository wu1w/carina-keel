/**
 * zh: 本进程最后一帧和最后一段短片。给页面主视口，不进图谱。
 * en: Last still and clip in this process. For the stage; not graph truth.
 */
export type CachedStill = {
  mime: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  placeId?: string;
};

/**
 * zh: 缓存的短片。
 * en: A cached clip.
 */
export type CachedClip = {
  mime: string;
  fps: number;
  frames: string[];
  width?: number;
  height?: number;
  placeId?: string;
};

/**
 * zh: 进程内最后画面缓存。
 * en: In-process last-view cache.
 */
export type ViewCache = {
  /**
   * zh: 读取当前静帧。
   * en: Read the current still.
   */
  get(): CachedStill | undefined;
  /**
   * zh: 读取当前短片。
   * en: Read the current clip.
   */
  getClip(): CachedClip | undefined;
  /**
   * zh: 用 look 静帧覆盖当前画面。
   * en: Replace the current frame with a look still.
   */
  set(still: {
    mime: string;
    base64: string;
    width?: number;
    height?: number;
    placeId?: string;
  }): void;
  /**
   * zh: 用 look 短片覆盖当前画面，并用末帧当静帧。
   * en: Replace the current view with a look clip; last frame becomes the still.
   */
  setClip(clip: CachedClip): void;
};

/**
 * zh: 创建空的画面缓存。
 * en: Create an empty view cache.
 */
export function createViewCache(): ViewCache {
  let last: CachedStill | undefined;
  let clip: CachedClip | undefined;
  return {
    get() {
      return last;
    },
    getClip() {
      return clip;
    },
    set(still) {
      last = {
        mime: still.mime,
        bytes: Buffer.from(still.base64, "base64"),
        ...(still.width !== undefined ? { width: still.width } : {}),
        ...(still.height !== undefined ? { height: still.height } : {}),
        ...(still.placeId !== undefined ? { placeId: still.placeId } : {}),
      };
    },
    setClip(next) {
      clip = next;
      const lastFrame = next.frames[next.frames.length - 1];
      if (lastFrame !== undefined) {
        last = {
          mime: next.mime,
          bytes: Buffer.from(lastFrame, "base64"),
          ...(next.width !== undefined ? { width: next.width } : {}),
          ...(next.height !== undefined ? { height: next.height } : {}),
          ...(next.placeId !== undefined ? { placeId: next.placeId } : {}),
        };
      }
    },
  };
}
