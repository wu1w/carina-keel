import { z } from "zod";
import { scaleStatusSchema } from "./enums.js";

/**
 * zh: 米制直角坐标。世界规范：右手系、Y 向上。
 * en: Metric Cartesian point. World frame is right-handed, Y-up.
 */
export const vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export type Vec3 = z.infer<typeof vec3Schema>;

/**
 * zh: 轴对齐包围盒。
 * en: Axis-aligned bounding box.
 */
export const aabbSchema = z.object({
  min: vec3Schema,
  max: vec3Schema,
});

export type Aabb = z.infer<typeof aabbSchema>;

/**
 * zh: 对象变换。旋转为欧拉角（弧度），XYZ 顺序。
 * en: Object transform. Rotation is XYZ Euler radians.
 */
export const transformSchema = z.object({
  position: vec3Schema,
  rotation: vec3Schema,
  scale: vec3Schema,
});

export type Transform = z.infer<typeof transformSchema>;

/**
 * zh: 世界坐标架。
 * en: World coordinate frame metadata.
 */
export const coordinateFrameSchema = z.object({
  units: z.literal("meters"),
  handedness: z.literal("right"),
  up: z.literal("y"),
  scaleStatus: scaleStatusSchema,
});

export type CoordinateFrame = z.infer<typeof coordinateFrameSchema>;
