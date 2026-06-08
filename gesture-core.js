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
    holdFrames: 10, // fist must be held this many frames (~0.35s @30fps) to toggle play/pause
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
    let fistFrames = 0; // consecutive frames the fist has been held (while not dragging)
    let toggleArmed = true; // edge gate: must see a non-fist frame before toggling again

    function reset() {
      state = "IDLE";
      xSmooth = null;
      anchorX = 0;
      anchorFraction = 0;
      fistFrames = 0;
      toggleArmed = true;
    }

    function update(frame, video) {
      // No hand, or malformed coordinates: release, clear the smoother so a bad
      // frame can't poison later frames, and re-arm the fist toggle.
      if (!frame || !frame.present || !isFiniteNum(frame.x)) {
        state = "IDLE";
        xSmooth = null;
        fistFrames = 0;
        toggleArmed = true;
        return { state: state, seekTo: null, fraction: null, togglePlay: false };
      }

      const fist = !!frame.fist;
      const d = frame.d;
      xSmooth = xSmooth === null ? frame.x : o.ema * frame.x + (1 - o.ema) * xSmooth;

      // Video must be seekable: finite, positive duration and a finite position.
      const ready = !!video && durationOk(video.duration) && isFiniteNum(video.currentTime);

      let seekTo = null;
      let fraction = null;

      // --- pinch / scrub state machine (entry gated on !fist: fist != pinch) ---
      if (state === "IDLE") {
        if (!fist && isFiniteNum(d) && d < o.pinchOn && ready) {
          state = "DRAGGING";
          // Snap the smoother to the raw x at entry so a still hand => still video.
          xSmooth = frame.x;
          anchorX = frame.x;
          anchorFraction = clamp01(video.currentTime / video.duration);
        }
      } else {
        // DRAGGING — release on a non-pinch (or NaN d), or if a fist is detected.
        if (fist || !(isFiniteNum(d) && d <= o.pinchOff)) {
          state = "IDLE";
        } else if (ready) {
          fraction = clamp01(anchorFraction + (xSmooth - anchorX));
          seekTo = fraction * video.duration;
        }
      }

      // --- fist toggle (debounced + edge-triggered; never while dragging) ---
      let togglePlay = false;
      if (state === "DRAGGING") {
        fistFrames = 0; // scrubbing: ignore fist entirely
      } else if (fist) {
        fistFrames++;
        if (fistFrames >= o.holdFrames && toggleArmed) {
          togglePlay = true;
          toggleArmed = false; // fire once; require an open frame to re-arm
        }
      } else {
        fistFrames = 0;
        toggleArmed = true; // hand opened => allow the next fist to toggle
      }

      return { state: state, seekTo: seekTo, fraction: fraction, togglePlay: togglePlay };
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
