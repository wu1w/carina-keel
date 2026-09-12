import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readCandidateObservation,
  writeCandidateObservation,
} from "./candidate-observation.js";
import type { WorldObservation } from "./observe.js";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

test("candidate observation persists a still and refuses to call it frozen mesh", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "carina-candidate-"));
  try {
    const observation: WorldObservation = {
      media: "view",
      provider: "lingbot-legacy",
      legacy: true,
      frozen: false,
      prompt: "酒馆",
      shotKind: "scene",
      still: {
        mime: "image/jpeg",
        base64: Buffer.from(JPEG).toString("base64"),
        width: 8,
        height: 4,
      },
    };
    await writeCandidateObservation(dir, observation);
    const loaded = await readCandidateObservation(dir);
    assert.ok(loaded !== undefined);
    assert.equal(loaded.frozen, false);
    assert.equal(loaded.legacy, true);
    assert.equal(loaded.prompt, "酒馆");
    assert.equal(loaded.shotKind, "scene");
    assert.equal(loaded.still?.base64, observation.still?.base64);
    assert.equal(loaded.clip, undefined);
    assert.equal(loaded.still?.width, 8);
    assert.equal(loaded.media, "view");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("candidate observation refuses stillFile path escape and frozen mesh claims", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "carina-candidate-escape-"));
  try {
    await writeFile(
      path.join(dir, "candidate-observation.json"),
      `${JSON.stringify({
        frozen: false,
        notGraphTruth: true,
        stillFile: "../secret.jpg",
        mime: "image/jpeg",
      })}\n`,
    );
    assert.equal(await readCandidateObservation(dir), undefined);
    await writeFile(
      path.join(dir, "candidate-observation.json"),
      `${JSON.stringify({
        frozen: true,
        notGraphTruth: true,
        stillFile: "candidate-still.jpg",
        mime: "image/jpeg",
      })}\n`,
    );
    await writeFile(path.join(dir, "candidate-still.jpg"), JPEG);
    assert.equal(await readCandidateObservation(dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing candidate observation file is undefined, not a mock tavern", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "carina-candidate-empty-"));
  try {
    const loaded = await readCandidateObservation(dir);
    assert.equal(loaded, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
