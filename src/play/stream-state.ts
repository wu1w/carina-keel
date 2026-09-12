/**
 * zh: 产品主视口串流状态。断开时不得把 WebGL 粗模当成高质量回退。
 * en: Product viewport stream state. Disconnect must not treat the WebGL mock as HQ fallback.
 */
export type StreamPhase =
  | "connecting"
  | "live"
  | "disconnected"
  | "reconnecting";

export type StreamEvent =
  | "start"
  | "signallingUp"
  | "iceConnected"
  | "disconnect"
  | "retry"
  | "giveUp";

export type StreamHqFallback = "none";

/**
 * zh: 串流状态机。signalling HTTP 不算 WebRTC；iceConnected 才算媒体活着。
 * en: Stream state machine. Signalling HTTP is not WebRTC; iceConnected means media is live.
 */
export function nextStreamPhase(
  phase: StreamPhase,
  event: StreamEvent,
): StreamPhase {
  if (event === "start") {
    return "connecting";
  }
  if (event === "iceConnected") {
    return "live";
  }
  if (event === "signallingUp") {
    return phase === "live" ? "live" : "connecting";
  }
  if (event === "retry") {
    return "reconnecting";
  }
  if (event === "giveUp" || event === "disconnect") {
    return "disconnected";
  }
  return phase;
}

/**
 * zh: 高质量回退永远是 none；WebGL 粗模不是高质量画面。
 * en: HQ fallback is always none; the WebGL mock is not a high-quality picture.
 */
export function streamHqFallback(_phase: StreamPhase): StreamHqFallback {
  return "none";
}

/**
 * zh: 仅 live 显示串流视频。
 * en: Show the stream video only while live.
 */
export function streamVideoVisible(phase: StreamPhase): boolean {
  return phase === "live";
}

/**
 * zh: 叠加文案。生成停与运行时断开不得混用。
 * en: Overlay copy. Generation-stopped and runtime-down must not share a sentence.
 */
export function streamOverlayKey(
  phase: StreamPhase,
  input: { generationStopped: boolean; runtimeDown: boolean },
):
  | "ui.streamConnecting"
  | "ui.streamDisconnected"
  | "ui.streamReconnecting"
  | "ui.generationStoppedPlayable"
  | "ui.runtimeDisconnected"
  | null {
  if (input.runtimeDown) {
    return "ui.runtimeDisconnected";
  }
  if (phase === "connecting") {
    return "ui.streamConnecting";
  }
  if (phase === "reconnecting") {
    return "ui.streamReconnecting";
  }
  if (phase === "disconnected") {
    return "ui.streamDisconnected";
  }
  if (input.generationStopped) {
    return "ui.generationStoppedPlayable";
  }
  return null;
}
