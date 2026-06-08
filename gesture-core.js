// gesture-core.js — pure gesture→seek decision logic, no DOM.
// UMD: works as CommonJS (node tests) and as a classic content-script global.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GestureCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULTS = {
    pinchOn: 0.05, // enter DRAGGING when thumb-index distance < this
    pinchOff: 0.07, // leave DRAGGING when distance > this (hysteresis)
    ema: 0.5, // x smoothing factor (0..1], higher = more responsive
  };

  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  // NaN-safe: NaN and negatives clamp to 0, >1 clamps to 1.
  function clamp01(v) {
    if (!(v > 0)) return 0;
    if (v > 1) return 1;
    return v;
  }

  function durationOk(d) {
    return isFiniteNum(d) && d > 0;
  }

  // Creates a stateful machine.
  //   update(frame, video) -> { state, seekTo, fraction }
  //     frame: { x:0..1 (already mirrored), d: pinch distance, present: bool }
  //     video: { currentTime: number, duration: number }
  //     seekTo: seconds to seek to, or null when no seek this frame
  function createMachine(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    let state = "IDLE";
    let xSmooth = null;
    let anchorX = 0;
    let anchorFraction = 0;

    function reset() {
      state = "IDLE";
      xSmooth = null;
      anchorX = 0;
      anchorFraction = 0;
    }

    function update(frame, video) {
      // No hand, or malformed coordinates: release and clear the smoother so a
      // bad frame can never poison subsequent frames.
      if (!frame || !frame.present || !isFiniteNum(frame.x)) {
        state = "IDLE";
        xSmooth = null;
        return { state: state, seekTo: null, fraction: null };
      }

      const d = frame.d;
      xSmooth = xSmooth === null ? frame.x : o.ema * frame.x + (1 - o.ema) * xSmooth;

      // Video must be seekable: finite, positive duration and a finite position.
      const ready = !!video && durationOk(video.duration) && isFiniteNum(video.currentTime);

      if (state === "IDLE") {
        if (isFiniteNum(d) && d < o.pinchOn && ready) {
          state = "DRAGGING";
          // Snap the smoother to the raw x at entry so a still hand => still video
          // (otherwise EMA lag from prior IDLE frames makes the video creep).
          xSmooth = frame.x;
          anchorX = frame.x;
          anchorFraction = clamp01(video.currentTime / video.duration);
        }
        return { state: state, seekTo: null, fraction: null };
      }

      // state === DRAGGING — release on anything that is not clearly still a pinch
      // (covers d > pinchOff AND NaN/undefined d, which must not lock the machine).
      if (!(isFiniteNum(d) && d <= o.pinchOff)) {
        state = "IDLE";
        return { state: state, seekTo: null, fraction: null };
      }
      if (!ready) return { state: state, seekTo: null, fraction: null };

      const fraction = clamp01(anchorFraction + (xSmooth - anchorX));
      return { state: state, seekTo: fraction * video.duration, fraction: fraction };
    }

    return {
      update: update,
      reset: reset,
      get state() {
        return state;
      },
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    clamp01: clamp01,
    durationOk: durationOk,
    isFiniteNum: isFiniteNum,
    createMachine: createMachine,
  };
});
