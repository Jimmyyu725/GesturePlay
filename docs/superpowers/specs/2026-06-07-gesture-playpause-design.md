# GestureSeek — Fist toggles play/pause + fix fist-misread-as-pinch (v0.5)

> Date: 2026-06-07
> Status: Passed brainstorm, pending implementation
> Related: extends `2026-06-07-gesture-seek-design.md`

---

## 1. Goals

1. **New feature:** **fist ✊ = toggle play/pause**; open palm = neutral (resting pose, no action).
2. **Bug fix:** today a fist brings the thumb tip and index tip close together and is misread as a pinch → it falsely triggers scrubbing. After the fix, a fist no longer triggers it.

User choices:
- Play/pause mapping = **fist toggles** (option A), to avoid "open palm = play" firing in the resting pose.
- Detection engine = **GestureRecognizer (option ②)** active; **HandLandmarker (option ①)** retained, switchable via a constant.

## 2. Key insight: the bug and the feature share a root cause

The current pinch test only checks "thumb tip ↔ index tip distance < threshold". A fist also brings those tips close → misread as a pinch. Reliably recognizing a fist requires distinguishing "pinch vs fist", which is exactly what fixes the bug. Use GestureRecognizer's trained `Closed_Fist` label for the fist — accurate, and it solves the bug along the way.

## 3. Detection engine (both retained, switchable via a constant)

Constant `ENGINE` at the top of `camera.js`:
- `"gesture"` (**default = option ②**): `GestureRecognizer` + `models/gesture_recognizer.task`, `recognizeForVideo()`. Returns **a gesture label + 21 landmarks**.
- `"landmarker"` (**retained = option ①**): the existing `HandLandmarker` + `models/hand_landmarker.task`, `detectForVideo()`. Pinch only, no fist (i.e. the current behavior).

Both models are bundled; switching changes only this one constant. GPU delegate (CPU fallback) applies to both.

### GestureRecognizer result shape (verified)
- `result.landmarks[handIndex][pointIndex] = {x, y, z}`, x/y normalized [0,1].
- `result.gestures[handIndex][0].categoryName`: one of 8 (`None`/`Closed_Fist`/`Open_Palm`/`Pointing_Up`/`Thumb_Up`/`Thumb_Down`/`Victory`/`ILoveYou`) — **no "pinch"**.
- Take the highest-confidence hand (`numHands: 1`).

## 4. Where each of the three things comes from

| Gesture | Source | Action |
|---------|--------|--------|
| Pinch to scrub | **Landmarks**: thumb tip (4) ↔ index tip (8) distance, mirrored x (unchanged) | drag `currentTime` |
| Fist toggle | **Label** `categoryName === "Closed_Fist"` | `video.play()/pause()` toggle |
| Open palm / other | Neutral | none |

## 5. Per-frame message (camera.js → content.js)

`{ type:"gs-frame", x, d, present, fist }`
- `x` = mirrored hand x (0..1), `d` = normalized thumb-index distance, `present` = whether a hand is seen.
- `fist` = `(ENGINE==="gesture") && categoryName==="Closed_Fist"`; always `false` under the `landmarker` engine.

## 6. Decision logic (gesture-core.js, pure functions, unit-testable)

The pinch state machine is unchanged; **fist handling is added**:

```
input per frame: {x, d, present, fist}, video:{currentTime, duration, paused?}

// Pinch (scrub): unchanged. But do NOT enter DRAGGING while fist is true
//   (fist ≠ pinch). Under GestureRecognizer a fist is Closed_Fist, mutually
//   exclusive with a pinch; gesture-core still explicitly requires !fist to
//   enter DRAGGING, fully blocking the false trigger.

// Fist toggle (debounce + edge + suppressed while dragging):
fistStableFrames: increments while fist is true, resets otherwise
canToggle: a boolean gate; set false after a toggle fires, only a non-fist frame re-arms it

each frame:
  if state==DRAGGING: ignore fist (don't toggle mid-scrub); fist shouldn't be true anyway (exclusive)
  else if fist:
     if held ≥ HOLD (~0.35s, ≈ HOLD_FRAMES frames) and canToggle:
        emit togglePlay = true (this frame only)
        canToggle = false
  else (not a fist):
     canToggle = true (must release before it can fire again)
     fistStableFrames = 0
```

New output field: `togglePlay: boolean` (whether to toggle play/pause this frame). The pinch output `seekTo` is unchanged.

**Mutual exclusion:** pinch entry adds `!fist`; fist handling only runs while not DRAGGING. The two never fire on the same frame.

## 7. content.js

- On `gs-frame` → `machine.update(...)`:
  - `res.seekTo != null` → scrub (unchanged: adaptive throttle + precise commit on release).
  - `res.togglePlay === true` → `v.paused ? v.play() : v.pause()` (ignore play()'s promise rejection). Also `nudgeControls(v)` to reveal the native UI.
- No custom UI; play/pause uses the site's native animation.

## 8. Anti-false-trigger parameters (initial)

- `HOLD_FRAMES`: ~0.35s. Detection is throttled to 30fps (setTimeout 33ms) → ~10 frames.
- Edge: one fist toggles once; a non-fist frame must appear before the next.
- No fist response while DRAGGING.

## 9. Edge cases & regression

| Case | Handling |
|------|----------|
| Hand passes through a fist-like shape while releasing a pinch | debounce (350ms) + edge → no false toggle |
| Fist held continuously | toggles once (edge), not repeatedly |
| `landmarker` engine (option ①) | `fist` always false → no fist feature, pinch behavior unchanged |
| Live / invalid duration | pinch doesn't trigger (unchanged); fist toggle still works (play/pause is independent of duration) |
| Two hands | `numHands:1`, take the highest confidence |

## 10. Tests (gesture-core.test.js extension)

- Fist held ≥ threshold → `togglePlay` fires exactly once (edge).
- Fist held but below threshold → no toggle.
- After firing, keep holding → no re-toggle; release (a non-fist frame) then fist again → toggles once more.
- fist=true while DRAGGING → no toggle, doesn't affect the drag (and pinch entry requires !fist).
- The existing 26 pinch tests stay green.

## 10b. v0.5.1: pinch requires "three fingers up" to trigger (cut false triggers)

User feedback: checking only thumb-index distance had a high false-trigger rate (a hand resting near the face was treated as a pinch). Changed so that **entering a drag requires a deliberate pose**: thumb + index pinched **and middle/ring/pinky all raised**.

- camera.js computes the extended-finger count `ext` (0–3) from landmarks: a finger is extended when **its tip is farther from the wrist than its PIP joint** (2D, rotation-invariant). Sent with each frame.
- gesture-core adds the entry condition `frame.ext >= requiredFingers` (default 3). **Entry-only:** once dragging, a finger wobble won't interrupt it (continuation only checks the pinch distance).
- Backward compatible: when `frame.ext` is absent, the gate is skipped (old tests unaffected).
- Tests: `ext>=3` enters; `ext∈{0,1,2}` does not; after entry `ext` dropping to 0 keeps dragging; absent ext still enters.

## 10c. v0.5.2: start deadzone (no movement right after the pinch; scrub only once the hand moves enough)

User feedback: the bar twitches from tiny movement the instant you pinch. Added a **start activation deadzone**:

- After entering DRAGGING, `dragActive=false` and no `seekTo` is emitted; only when `|xSmooth − anchorX| ≥ deadzone` (default 0.05 normalized width) does `dragActive=true` and scrubbing begin.
- On activation, the deadzone is **folded into the anchor** (`anchorX += ±deadzone`): no jump at activation, and movement beyond the deadzone is fully preserved (eff = raw − deadzone).
- **Entry-only:** after activation it tracks 1:1 (deadzone no longer applies), so pulling the hand back won't jitter by re-entering the deadzone.
- Release/reset clears `dragActive`. `deadzone:0` disables it (used by tests).

## 11. Out of scope (YAGNI)

- Don't use `Open_Palm` for anything (the fist already toggles both ways).
- No custom UI for play/pause (use native).
- No other gestures (👍👎✌️ etc.).

## 12. v0.6.0: settings popup + optional camera/skeleton preview

Borrowed from reviewing another extension ("YouTube Shorts Gesture Control"). Two additions:

- **Settings popup (sliders, apply live):** start deadzone, fist hold time (seconds → `holdFrames`), fingers required to scrub (1–3 → `requiredFingers`), pinch sensitivity (`pinchOn`, with `pinchOff = pinchOn + 0.02`). popup.js writes to `chrome.storage.local`; content.js reads them, rebuilds the gesture machine on change, and re-applies live. The preview toggle is a **pure UI change** and does NOT rebuild the machine (so it never drops an in-progress gesture).
- **Optional camera + skeleton preview:** a popup toggle. When on, content.js resizes the camera iframe into a visible 240×180 corner window and tells camera.js (via a `gs-preview` message, resent on `gs-ready`) to draw the mirrored webcam + 21-point hand skeleton onto a canvas. Off by default; useful while tuning. (Not painted in real fullscreen — acceptable for a debug aid.)

## 13. v0.8.0: tier-1 improvements

- **Master switch (`gsEnabled`):** a prominent popup toggle; off calls removeIframe() (camera fully stops), on re-runs sync(). The activation gate in sync() checks `enabled` first.
- **Fist hold timing by timestamp:** gesture-core's fist debounce switched from frame counting (`holdFrames`, which assumed a steady 30fps — on a slow CPU-fallback machine "0.35s" silently stretched) to wall-clock milliseconds (`holdMs`). `update(frame, video, nowMs)` takes a monotonic timestamp (content.js passes `performance.now()`); a synthetic ~33ms/call clock keeps timestamp-less callers/tests working.
- **Settings roam via `chrome.storage.sync`:** all settings moved from storage.local to storage.sync (follows the Chrome profile across machines). Slider writes are debounced (200ms) to stay inside sync's write quotas. A one-time `gsMigrated`-flagged migration carries old local values over. The first-run camera hint stays in storage.local on purpose (camera permission is per-device).
- **CI + LICENSE:** GitHub Actions workflow runs the unit tests, syntax checks, manifest validation, and i18n key-parity on every push/PR. MIT license added.
