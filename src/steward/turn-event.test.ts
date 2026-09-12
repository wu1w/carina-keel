import assert from "node:assert/strict";
import test from "node:test";
import {
  eventsFromStreamPart,
  stillEventFromLookOutput,
} from "./turn-event.js";

/**
 * zh: look 工具结果带 still 时抽出静帧事件。
 * en: A look tool result with a still becomes a still event.
 */
test("stillEventFromLookOutput reads still and placeId", () => {
  const event = stillEventFromLookOutput({
    ok: true,
    summary: "looked",
    data: {
      placeId: "place-1",
      still: { mime: "image/jpeg", base64: "AAAA", width: 8, height: 4 },
      placeName: "湖边酒馆",
    },
  });
  assert.deepEqual(event, {
    type: "still",
    mime: "image/jpeg",
    base64: "AAAA",
    width: 8,
    height: 4,
    placeId: "place-1",
    placeName: "湖边酒馆",
  });
});

/**
 * zh: 没有 still 则不发画面事件。
 * en: No still means no still event.
 */
test("stillEventFromLookOutput returns undefined without still", () => {
  assert.equal(
    stillEventFromLookOutput({ ok: true, data: { placeId: "p" } }),
    undefined,
  );
});

/**
 * zh: fullStream 的 look 开始、静帧、文字增量变成壳事件。
 * en: fullStream look start, still, and text delta become shell events.
 */
test("eventsFromStreamPart maps look start, still, and text", () => {
  assert.deepEqual(
    eventsFromStreamPart({ type: "tool-input-start", toolName: "look" }),
    [{ type: "status", tool: "look" }],
  );
  assert.deepEqual(
    eventsFromStreamPart({
      type: "tool-result",
      toolName: "look",
      output: {
        ok: true,
        data: {
          clip: { mime: "image/jpeg", fps: 8, frames: ["AA", "BB"] },
          still: { mime: "image/jpeg", base64: "BB" },
        },
      },
    }),
    [
      {
        type: "clip",
        mime: "image/jpeg",
        fps: 8,
        frames: ["AA", "BB"],
      },
    ],
  );
  assert.deepEqual(
    eventsFromStreamPart({
      type: "tool-result",
      toolName: "look",
      output: {
        ok: true,
        data: { still: { mime: "image/jpeg", base64: "BB" } },
      },
    }),
    [{ type: "still", mime: "image/jpeg", base64: "BB" }],
  );
  assert.deepEqual(eventsFromStreamPart({ type: "text-delta", text: "hi" }), [
    { type: "text", text: "hi" },
  ]);
  assert.deepEqual(
    eventsFromStreamPart({ type: "tool-input-start", toolName: "go" }),
    [],
  );
});
