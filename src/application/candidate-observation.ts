import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../pack/open.js";
import { isNodeErrno } from "../pack/sandbox.js";
import {
  stillBytesFromObservation,
  type WorldObservation,
} from "./observe.js";
import type { ShotKind } from "../steward/world-model-brief.js";

const META_NAME = "candidate-observation.json";
const STILL_NAME = "candidate-still.jpg";

type CandidateMeta = {
  frozen: false;
  legacy: true;
  provider: "lingbot-legacy";
  notGraphTruth: true;
  mime: string;
  media: string;
  stillFile: string;
  prompt?: string;
  style?: string;
  camera?: string;
  shotKind?: ShotKind;
  width?: number;
  height?: number;
};

/**
 * zh: 把候选静帧写入世界包。不是图谱真相，也不冻结网格。
 * en: Write the candidate still into the world pack. Not graph truth and not frozen mesh.
 */
export async function writeCandidateObservation(
  packDir: string,
  observation: WorldObservation,
): Promise<void> {
  const still = stillBytesFromObservation(observation);
  if (still === undefined) {
    return;
  }
  const dir = path.resolve(packDir);
  await mkdir(dir, { recursive: true });
  const stillPath = path.join(dir, STILL_NAME);
  await writeFileAtomic(stillPath, still.bytes);
  const meta: CandidateMeta = {
    frozen: false,
    legacy: true,
    provider: "lingbot-legacy",
    notGraphTruth: true,
    mime: still.mime,
    media: observation.media,
    stillFile: STILL_NAME,
  };
  if (observation.prompt !== undefined) {
    meta.prompt = observation.prompt;
  }
  if (observation.style !== undefined) {
    meta.style = observation.style;
  }
  if (observation.camera !== undefined) {
    meta.camera = observation.camera;
  }
  if (observation.shotKind !== undefined) {
    meta.shotKind = observation.shotKind;
  }
  if (observation.still?.width !== undefined) {
    meta.width = observation.still.width;
  } else if (observation.clip?.width !== undefined) {
    meta.width = observation.clip.width;
  }
  if (observation.still?.height !== undefined) {
    meta.height = observation.still.height;
  } else if (observation.clip?.height !== undefined) {
    meta.height = observation.clip.height;
  }
  await writeFileAtomic(
    path.join(dir, META_NAME),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
}

/**
 * zh: 从世界包读出上次候选静帧。没有短片，也没有网格。
 * en: Read the last candidate still from the pack. No clip and no mesh.
 */
export async function readCandidateObservation(
  packDir: string,
): Promise<WorldObservation | undefined> {
  const dir = path.resolve(packDir);
  let raw: string;
  try {
    raw = await readFile(path.join(dir, META_NAME), "utf8");
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      return undefined;
    }
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  const meta = parsed as Record<string, unknown>;
  if (meta["frozen"] !== false || meta["notGraphTruth"] !== true) {
    return undefined;
  }
  const stillFile =
    typeof meta["stillFile"] === "string" ? meta["stillFile"] : STILL_NAME;
  if (stillFile !== STILL_NAME) {
    return undefined;
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path.join(dir, STILL_NAME));
  } catch {
    return undefined;
  }
  if (bytes.byteLength < 2) {
    return undefined;
  }
  const mime =
    typeof meta["mime"] === "string" && meta["mime"].length > 0
      ? meta["mime"]
      : "image/jpeg";
  const media =
    typeof meta["media"] === "string" && meta["media"].length > 0
      ? meta["media"]
      : "view";
  const observation: WorldObservation = {
    media,
    provider: "lingbot-legacy",
    legacy: true,
    frozen: false,
    still: {
      mime,
      base64: Buffer.from(bytes).toString("base64"),
      ...(typeof meta["width"] === "number" ? { width: meta["width"] } : {}),
      ...(typeof meta["height"] === "number"
        ? { height: meta["height"] }
        : {}),
    },
  };
  if (typeof meta["prompt"] === "string") {
    observation.prompt = meta["prompt"];
  }
  if (typeof meta["style"] === "string") {
    observation.style = meta["style"];
  }
  if (typeof meta["camera"] === "string") {
    observation.camera = meta["camera"];
  }
  if (meta["shotKind"] === "camera" || meta["shotKind"] === "scene") {
    observation.shotKind = meta["shotKind"];
  }
  return observation;
}
