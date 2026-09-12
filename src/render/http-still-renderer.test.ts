import assert from "node:assert/strict";
import test from "node:test";
import { HttpStillRenderer } from "./http-still-renderer.js";
import type { RenderView } from "../schema/index.js";

const view: RenderView = {
  placeId: "01HXTAVERN0000000000000000",
  placeName: "Tavern",
  entities: [{ id: "01HXKEEP000000000000000000", name: "Innkeeper" }],
};

/**
 * zh: 1×1 JPEG，仅用于契约测试。
 * en: 1×1 JPEG used only for contract tests.
 */
const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z";

/**
 * zh: sidecar 200 时 media 含地点，并带上 still。
 * en: A 200 from the sidecar keeps the place in media and attaches a still.
 */
test("HttpStillRenderer attaches a still and keeps place text", async () => {
  let posted: unknown;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:18791/v1/still");
    posted = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        ok: true,
        mime: "image/jpeg",
        base64: TINY_JPEG,
        width: 832,
        height: 464,
        clip: {
          mime: "image/jpeg",
          fps: 8,
          frames: [TINY_JPEG, TINY_JPEG],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await new HttpStillRenderer(
    "http://127.0.0.1:18791/",
    fetchImpl,
  ).render(view);
  assert.match(result.media, /01HXTAVERN0000000000000000/);
  assert.match(result.media, /Tavern/);
  assert.match(result.media, /Innkeeper/);
  assert.match(result.media, /832×464/);
  assert.equal(result.still?.mime, "image/jpeg");
  assert.equal(result.still?.base64, TINY_JPEG);
  assert.equal(result.still?.width, 832);
  assert.equal(result.clip?.fps, 8);
  assert.equal(result.clip?.frames.length, 2);
  assert.equal(result.warnings, undefined);
  assert.deepEqual(posted, {
    placeId: "01HXTAVERN0000000000000000",
    placeName: "Tavern",
    entities: [{ id: "01HXKEEP000000000000000000", name: "Innkeeper" }],
  });
});

/**
 * zh: 玩家意图与 fresh 会交给 sidecar 去重做种子图。
 * en: Player intent and fresh are posted so the sidecar can bake a new seed.
 */
test("HttpStillRenderer posts intent and fresh for a new seed", async () => {
  let posted: unknown;
  const fetchImpl: typeof fetch = async (_input, init) => {
    posted = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        ok: true,
        mime: "image/jpeg",
        base64: TINY_JPEG,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  await new HttpStillRenderer(
    "http://127.0.0.1:18791",
    fetchImpl,
  ).render({
    ...view,
    intent: "走进湖边酒馆",
    fresh: true,
  });
  assert.equal(
    (posted as { intent?: string; fresh?: boolean }).intent,
    "走进湖边酒馆",
  );
  assert.equal((posted as { fresh?: boolean }).fresh, true);
});

/**
 * zh: sidecar 失败时退回纯文本，不写 still。
 * en: Sidecar failure falls back to text and omits still.
 */
test("HttpStillRenderer falls back to text when the sidecar fails", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 502 });
  const result = await new HttpStillRenderer(
    "http://127.0.0.1:18791",
    fetchImpl,
  ).render(view);
  assert.match(result.media, /01HXTAVERN0000000000000000/);
  assert.equal(result.still, undefined);
  assert.equal(result.warnings?.length, 1);
});
