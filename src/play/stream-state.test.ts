import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  nextStreamPhase,
  streamHqFallback,
  streamOverlayKey,
  streamVideoVisible,
  type StreamPhase,
} from "./stream-state.js";

/**
 * zh: 连接中 → 媒体连通 → 断开 → 重连。
 * en: connecting → live media → disconnect → reconnect.
 */
test("stream state machine walks connecting live disconnected reconnecting", () => {
  let phase: StreamPhase = nextStreamPhase("disconnected", "start");
  assert.equal(phase, "connecting");
  assert.equal(streamVideoVisible(phase), false);
  phase = nextStreamPhase(phase, "signallingUp");
  assert.equal(phase, "connecting");
  phase = nextStreamPhase(phase, "iceConnected");
  assert.equal(phase, "live");
  assert.equal(streamVideoVisible(phase), true);
  phase = nextStreamPhase(phase, "disconnect");
  assert.equal(phase, "disconnected");
  phase = nextStreamPhase(phase, "retry");
  assert.equal(phase, "reconnecting");
  phase = nextStreamPhase(phase, "iceConnected");
  assert.equal(phase, "live");
});

/**
 * zh: 断开时不得把 WebGL 粗模当成高质量回退。
 * en: Disconnect must not treat the WebGL mock as a high-quality fallback.
 */
test("disconnected stream never falls back to WebGL as high quality", () => {
  for (const phase of [
    "connecting",
    "live",
    "disconnected",
    "reconnecting",
  ] as const) {
    assert.equal(streamHqFallback(phase), "none");
  }
  assert.equal(
    streamOverlayKey("disconnected", {
      generationStopped: true,
      runtimeDown: false,
    }),
    "ui.streamDisconnected",
  );
  assert.equal(
    streamOverlayKey("live", {
      generationStopped: true,
      runtimeDown: false,
    }),
    "ui.generationStoppedPlayable",
  );
  assert.equal(
    streamOverlayKey("live", {
      generationStopped: false,
      runtimeDown: true,
    }),
    "ui.runtimeDisconnected",
  );
});

const html = readFileSync(
  new URL("../server/public/app.html", import.meta.url),
  "utf8",
);

function htmlFn(name: string): string {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `missing ${name} in app.html`);
  const end = html.indexOf("\n        }", start + 1) + "\n        }".length;
  return html.slice(start, end);
}

/**
 * zh: HTML 抽出的状态机与 src/play 一致，且页面含 PS2 视口。
 * en: HTML-extracted state machine matches src/play and the page has the PS2 viewport.
 */
test("app.html product viewport is PS2 with extracted stream helpers", () => {
  assert.match(html, /id="ps2-stream"/);
  assert.match(html, /id="stream-overlay"/);
  assert.match(html, /id="observation-badge"/);
  assert.match(html, /id="hide-observation"/);
  assert.match(html, /pixelStreamingUrl/);
  assert.doesNotMatch(html, /u_texOn=1/);
  assert.doesNotMatch(
    html,
    /function showFrame\([^)]*\) \{\s*if \(sceneMode \|\| surface/,
  );
  const observationVisible = html.match(
    /#observation\.visible \{[\s\S]*?z-index:\s*(\d+)/,
  );
  const ps2 = html.match(/#ps2-stream \{[\s\S]*?z-index:\s*(\d+)/);
  assert.ok(observationVisible !== null && ps2 !== null);
  assert.ok(Number(observationVisible[1]) > Number(ps2[1]));
  assert.match(html, /AbortSignal\.timeout\(620000\)/);
  const helpers = runInNewContext(
    htmlFn("nextStreamPhase") +
      htmlFn("streamHqFallback") +
      htmlFn("streamOverlayKey") +
      "\n({ nextStreamPhase, streamHqFallback, streamOverlayKey })",
  ) as {
    nextStreamPhase: typeof nextStreamPhase;
    streamHqFallback: typeof streamHqFallback;
    streamOverlayKey: (
      phase: StreamPhase,
      generationStopped: boolean,
      runtimeDown: boolean,
    ) => string;
  };
  assert.equal(helpers.nextStreamPhase("connecting", "iceConnected"), "live");
  assert.equal(helpers.streamHqFallback("disconnected"), "none");
  assert.equal(
    helpers.streamOverlayKey("disconnected", false, false),
    "ui.streamDisconnected",
  );
  assert.equal(
    helpers.streamOverlayKey("live", true, false),
    "ui.generationStoppedPlayable",
  );
  assert.equal(
    helpers.streamOverlayKey("live", false, true),
    "ui.runtimeDisconnected",
  );
});
