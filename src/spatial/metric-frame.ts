import type { CoordinateFrame } from "../schema/index.js";

/**
 * zh: 规范世界坐标架：米、右手系、Y 向上、尺度已锚定。
 * en: Canonical world frame: meters, right-handed, Y-up, scale anchored.
 */
export const METRIC_Y_UP: CoordinateFrame = {
  units: "meters",
  handedness: "right",
  up: "y",
  scaleStatus: "anchored",
};
