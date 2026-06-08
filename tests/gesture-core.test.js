// Unit tests for gesture-core.js — run with: node tests/gesture-core.test.js
const GC = require("../gesture-core.js");

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.error("  ✗ " + name);
  }
}
function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
}

console.log("gesture-core");

// 1. IDLE stays IDLE when not pinching (open hand, d large)
(function () {
  const m = GC.createMachine();
  const r = m.update({ x: 0.5, d: 0.3, present: true }, { currentTime: 10, duration: 100 });
  ok("open hand stays IDLE", m.state === "IDLE" && r.seekTo === null);
})();

// 2. Pinch with valid duration -> DRAGGING, no seek on the entry frame
(function () {
  const m = GC.createMachine();
  const r = m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 50, duration: 100 });
  ok("pinch enters DRAGGING", m.state === "DRAGGING");
  ok("entry frame does not seek", r.seekTo === null);
})();

// 3. Relative anchoring: pinch then hold still -> no jump (stays at anchor)
(function () {
  const m = GC.createMachine({ ema: 1, deadzone: 0 });
  m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 50, duration: 100 }); // anchor at 0.5
  const r = m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 50, duration: 100 });
  ok("hold still stays at anchor (no jump)", approx(r.seekTo, 50));
})();

// 4. Direction: hand moves right (x up) -> seek forward (ema=1, deadzone=0 for exact mapping)
(function () {
  const m = GC.createMachine({ ema: 1, deadzone: 0 });
  m.update({ x: 0.2, d: 0.03, present: true }, { currentTime: 0, duration: 100 }); // anchorFraction 0, anchorX 0.2
  const r = m.update({ x: 0.7, d: 0.03, present: true }, { currentTime: 0, duration: 100 });
  ok("move right seeks forward", r.seekTo > 0);
  ok("full-width mapping (Δx 0.5 -> 50s of 100s)", approx(r.seekTo, 50, 1e-6));
})();

// 5. Direction: hand moves left (x down) below anchor -> clamps at 0, not negative
(function () {
  const m = GC.createMachine({ ema: 1 });
  m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 10, duration: 100 }); // anchorFraction 0.1
  const r = m.update({ x: 0.0, d: 0.03, present: true }, { currentTime: 10, duration: 100 }); // 0.1 + (0-0.5) = -0.4 -> clamp 0
  ok("move left clamps at 0", approx(r.seekTo, 0));
})();

// 6. Clamp at end: large rightward move clamps to duration
(function () {
  const m = GC.createMachine({ ema: 1 });
  m.update({ x: 0.1, d: 0.03, present: true }, { currentTime: 90, duration: 100 }); // anchorFraction 0.9
  const r = m.update({ x: 1.0, d: 0.03, present: true }, { currentTime: 90, duration: 100 }); // 0.9+0.9=1.8 -> clamp 1
  ok("clamps to duration at end", approx(r.seekTo, 100));
})();

// 7. Hysteresis: in DRAGGING, d in (pinchOn, pinchOff) keeps dragging; d>pinchOff releases
(function () {
  const m = GC.createMachine({ ema: 1 });
  m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 0, duration: 100 });
  m.update({ x: 0.5, d: 0.06, present: true }, { currentTime: 0, duration: 100 }); // between thresholds
  ok("between thresholds keeps DRAGGING", m.state === "DRAGGING");
  m.update({ x: 0.5, d: 0.09, present: true }, { currentTime: 0, duration: 100 }); // above pinchOff
  ok("above pinchOff releases to IDLE", m.state === "IDLE");
})();

// 8. Losing the hand releases and produces no seek
(function () {
  const m = GC.createMachine({ ema: 1 });
  m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 0, duration: 100 });
  const r = m.update({ x: 0, d: 1, present: false }, { currentTime: 0, duration: 100 });
  ok("hand lost -> IDLE, no seek", m.state === "IDLE" && r.seekTo === null);
})();

// 9. Invalid duration never enters DRAGGING / never seeks
(function () {
  for (const dur of [NaN, 0, Infinity, undefined]) {
    const m = GC.createMachine({ ema: 1 });
    const r = m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 0, duration: dur });
    ok("duration=" + dur + " does not drag/seek", m.state === "IDLE" && r.seekTo === null);
  }
})();

// 10. clamp01 helper (NaN-safe)
(function () {
  ok("clamp01 low", GC.clamp01(-1) === 0);
  ok("clamp01 high", GC.clamp01(2) === 1);
  ok("clamp01 mid", GC.clamp01(0.4) === 0.4);
  ok("clamp01 NaN -> 0", GC.clamp01(NaN) === 0);
})();

// 11. REGRESSION: EMA + anchoring must NOT creep with default smoothing on.
// (Prior IDLE frames at one x, then pinch+hold at a different x with smoothing.)
(function () {
  const m = GC.createMachine({ deadzone: 0 }); // default ema=0.5 (smoothing ON)
  for (let k = 0; k < 8; k++) m.update({ x: 0.2, d: 0.3, present: true }, { currentTime: 50, duration: 100 });
  // pinch entry at x=0.8
  m.update({ x: 0.8, d: 0.03, present: true }, { currentTime: 50, duration: 100 });
  let maxDrift = 0;
  for (let k = 0; k < 20; k++) {
    const r = m.update({ x: 0.8, d: 0.03, present: true }, { currentTime: 50, duration: 100 });
    maxDrift = Math.max(maxDrift, Math.abs(r.seekTo - 50));
  }
  ok("still hand after pinch does not creep (drift < 0.01s)", maxDrift < 0.01);
})();

// 12. REGRESSION: a NaN x must not permanently poison the smoother.
(function () {
  const m = GC.createMachine({ ema: 0.5 });
  m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 0, duration: 100 }); // dragging
  const bad = m.update({ x: NaN, d: 0.03, present: true }, { currentTime: 0, duration: 100 });
  ok("NaN x releases to IDLE, no seek", m.state === "IDLE" && bad.seekTo === null);
  // recovers cleanly afterwards
  m.update({ x: 0.3, d: 0.03, present: true }, { currentTime: 0, duration: 100 }); // re-anchor
  const good = m.update({ x: 0.8, d: 0.03, present: true }, { currentTime: 0, duration: 100 });
  ok("recovers after NaN (finite seek)", GC.isFiniteNum(good.seekTo) && good.seekTo > 0);
})();

// 13. REGRESSION: NaN currentTime at entry must not enter DRAGGING / emit NaN.
(function () {
  const m = GC.createMachine({ ema: 1 });
  const r = m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: NaN, duration: 100 });
  ok("NaN currentTime does not drag/seek", m.state === "IDLE" && r.seekTo === null);
})();

// 14. REGRESSION: NaN distance while DRAGGING must release, not lock.
(function () {
  const m = GC.createMachine({ ema: 1 });
  m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 0, duration: 100 });
  const r = m.update({ x: 0.5, d: NaN, present: true }, { currentTime: 0, duration: 100 });
  ok("NaN distance releases DRAGGING", m.state === "IDLE" && r.seekTo === null);
})();

// 15. Overlay data contract: during DRAGGING, fraction is set and matches seekTo/duration.
(function () {
  const m = GC.createMachine({ ema: 1 });
  m.update({ x: 0.3, d: 0.03, present: true }, { currentTime: 0, duration: 200 }); // anchor
  const r = m.update({ x: 0.8, d: 0.03, present: true }, { currentTime: 0, duration: 200 });
  ok("dragging returns finite fraction in [0,1]", GC.isFiniteNum(r.fraction) && r.fraction >= 0 && r.fraction <= 1);
  ok("fraction matches seekTo/duration", approx(r.fraction, r.seekTo / 200, 1e-9));
})();

// 16. Fist held to threshold toggles play/pause exactly once (edge-triggered).
(function () {
  const m = GC.createMachine({ holdFrames: 3 });
  const v = { currentTime: 0, duration: 100 };
  const open = { x: 0.5, d: 0.3, present: true, fist: false };
  const fist = { x: 0.5, d: 0.3, present: true, fist: true };
  const r1 = m.update(fist, v);
  const r2 = m.update(fist, v);
  const r3 = m.update(fist, v); // 3rd frame hits holdFrames
  ok("fist reaches threshold -> toggle on 3rd frame", !r1.togglePlay && !r2.togglePlay && r3.togglePlay === true);
  const r4 = m.update(fist, v);
  ok("continued fist does NOT re-toggle", r4.togglePlay === false);
  m.update(open, v); // open hand re-arms
  m.update(fist, v);
  m.update(fist, v);
  const r7 = m.update(fist, v);
  ok("re-fist after opening toggles again", r7.togglePlay === true);
})();

// 17. Fist held below threshold never toggles.
(function () {
  const m = GC.createMachine({ holdFrames: 5 });
  const v = { currentTime: 0, duration: 100 };
  let any = false;
  for (let k = 0; k < 3; k++) if (m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v).togglePlay) any = true;
  ok("fist below hold threshold does not toggle", any === false);
})();

// 18. Losing the hand re-arms the fist toggle.
(function () {
  const m = GC.createMachine({ holdFrames: 2 });
  const v = { currentTime: 0, duration: 100 };
  m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v);
  const t = m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v);
  ok("fist toggles at threshold", t.togglePlay === true);
  m.update({ present: false }, v); // hand lost
  m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v);
  const t2 = m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v);
  ok("hand-lost re-arms the toggle", t2.togglePlay === true);
})();

// 19. BUG FIX: a fist with small thumb-index distance must NOT start scrubbing.
(function () {
  const m = GC.createMachine({ holdFrames: 3, ema: 1 });
  const v = { currentTime: 0, duration: 100 };
  const r = m.update({ x: 0.5, d: 0.03, present: true, fist: true }, v);
  ok("fist + small d does not enter DRAGGING (bug fix)", m.state === "IDLE" && r.seekTo === null);
})();

// 20. A fist during DRAGGING releases the drag without an immediate toggle/seek.
(function () {
  const m = GC.createMachine({ holdFrames: 3, ema: 1 });
  const v = { currentTime: 0, duration: 100 };
  m.update({ x: 0.5, d: 0.03, present: true, fist: false }, v); // enter DRAGGING
  ok("entered DRAGGING via pinch", m.state === "DRAGGING");
  const r = m.update({ x: 0.6, d: 0.03, present: true, fist: true }, v);
  ok("fist during drag releases, no immediate toggle/seek", m.state === "IDLE" && r.seekTo === null && !r.togglePlay);
})();

// 21. reset() clears the fist counter/arming.
(function () {
  const m = GC.createMachine({ holdFrames: 2 });
  const v = { currentTime: 0, duration: 100 };
  m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v); // fistFrames=1
  m.reset();
  const r1 = m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v); // must restart from 1
  ok("reset clears fist counter (no premature toggle)", r1.togglePlay === false);
  const r2 = m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v); // 2 -> toggle
  ok("toggles after reset + threshold", r2.togglePlay === true);
})();

// 22. Sustained fist AFTER a drag release eventually toggles.
(function () {
  const m = GC.createMachine({ holdFrames: 3, ema: 1 });
  const v = { currentTime: 0, duration: 100 };
  m.update({ x: 0.5, d: 0.03, present: true, fist: false }, v); // DRAGGING
  const rel = m.update({ x: 0.5, d: 0.03, present: true, fist: true }, v); // release, fistFrames=1
  ok("drag releases on fist with no immediate toggle", m.state === "IDLE" && !rel.togglePlay);
  m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v); // 2
  const t = m.update({ x: 0.5, d: 0.3, present: true, fist: true }, v); // 3 -> toggle
  ok("sustained fist after drag release toggles", t.togglePlay === true);
})();

// 23. Pinch with all 3 side fingers extended STARTS a scrub.
(function () {
  const m = GC.createMachine({ ema: 1 });
  const v = { currentTime: 0, duration: 100 };
  m.update({ x: 0.5, d: 0.03, present: true, ext: 3 }, v);
  ok("pinch + 3 fingers up enters DRAGGING", m.state === "DRAGGING");
})();

// 24. Pinch with too few fingers up does NOT start a scrub (anti false-trigger).
(function () {
  for (const e of [0, 1, 2]) {
    const m = GC.createMachine({ ema: 1 });
    const v = { currentTime: 0, duration: 100 };
    const r = m.update({ x: 0.5, d: 0.03, present: true, ext: e }, v);
    ok("pinch with ext=" + e + " does NOT scrub", m.state === "IDLE" && r.seekTo === null);
  }
})();

// 25. Finger gate is ENTRY-ONLY: a wobble (ext drops) mid-drag does not release.
(function () {
  const m = GC.createMachine({ ema: 1 });
  const v = { currentTime: 0, duration: 100 };
  m.update({ x: 0.3, d: 0.03, present: true, ext: 3 }, v); // enter
  const r = m.update({ x: 0.8, d: 0.03, present: true, ext: 0 }, v); // fingers dropped but still pinched
  ok("ext drop mid-drag keeps DRAGGING", m.state === "DRAGGING" && r.seekTo > 0);
})();

// 26. Backward-compat: when ext is absent, the pose gate is skipped (still scrubs).
(function () {
  const m = GC.createMachine({ ema: 1 });
  const v = { currentTime: 0, duration: 100 };
  m.update({ x: 0.5, d: 0.03, present: true }, v); // no ext field
  ok("absent ext => gate skipped, enters DRAGGING", m.state === "DRAGGING");
})();

// 27. Start deadzone: tiny movement right after pinch does NOT move the bar.
(function () {
  const m = GC.createMachine({ ema: 1, deadzone: 0.1 });
  const v = { currentTime: 50, duration: 100 };
  m.update({ x: 0.5, d: 0.03, present: true, ext: 3 }, v); // enter; anchor 0.5
  const r1 = m.update({ x: 0.54, d: 0.03, present: true, ext: 3 }, v); // moved 0.04 < 0.1
  ok("small move within deadzone => no seek", r1.seekTo === null);
  const r2 = m.update({ x: 0.65, d: 0.03, present: true, ext: 3 }, v); // moved 0.15 >= 0.1
  ok("move beyond deadzone => seek starts", r2.seekTo !== null);
})();

// 28. Deadzone activation has no jump and preserves the overshoot (eff = raw - deadzone).
(function () {
  const m = GC.createMachine({ ema: 1, deadzone: 0.1 });
  const v = { currentTime: 0, duration: 100 };
  m.update({ x: 0.2, d: 0.03, present: true, ext: 3 }, v); // anchor 0.2, fraction 0
  const r = m.update({ x: 0.35, d: 0.03, present: true, ext: 3 }, v); // raw 0.15 -> eff 0.05
  ok("activation has no jump (eff = raw - deadzone => 5s, not 15s)", approx(r.seekTo, 5, 1e-6));
})();

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
