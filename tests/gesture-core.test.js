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
  const m = GC.createMachine({ ema: 1 });
  m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 50, duration: 100 }); // anchor at 0.5
  const r = m.update({ x: 0.5, d: 0.03, present: true }, { currentTime: 50, duration: 100 });
  ok("hold still stays at anchor (no jump)", approx(r.seekTo, 50));
})();

// 4. Direction: hand moves right (x up) -> seek forward (ema=1 for exact mapping)
(function () {
  const m = GC.createMachine({ ema: 1 });
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
  const m = GC.createMachine(); // default ema=0.5 (smoothing ON)
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

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
