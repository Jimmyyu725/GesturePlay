# GestureSeek — Design Doc (v2, technically verified)

> Chrome extension for scrubbing a video's progress bar with a webcam pinch gesture
> Date: 2026-06-07
> Status: Passed brainstorm + technical verification. **v2: verification overturned the offscreen-camera approach; switched to an extension-origin iframe.**

---

## 1. Goals & scope

Use a USB webcam to recognize a **pinch gesture (👌) + horizontal hand movement** and **scrub** YouTube and Bilibili video playback in real time, like dragging the real progress bar.

**Research conclusion:** no existing extension does this. Existing ones are either webcam gestures that only scroll / play-pause, or progress-bar dragging done with mouse/touch. This is an open niche.

### Core interaction (confirmed)
- **Gesture:** pinch (thumb tip ↔ index tip distance shrinks) = grab the bar; release = drop it.
- **Response:** live scrub — the video jumps as the hand moves.
- **Mapping:** full camera width = the whole video (proportional to duration).
- **Relative anchoring:** at the moment of the pinch, anchor to the current playback point, so a still hand = a still video; it never jumps the instant you pinch.
- **Camera:** tracking starts automatically on a YouTube/Bilibili tab (USB camera, no battery concern). One-time "Allow" the first time.
- **Feedback:** no extra UI during normal use — rely on the native progress bar; only show a small auto-dismissing toast on error (camera denied, etc.).

### Out of scope (YAGNI)
- ❌ Other gestures (play/pause/volume)
- ❌ Settings page (sensitivity fixed at "full width = whole video")
- ❌ Persistent camera preview / skeleton UI
- ❌ Sites other than YouTube / Bilibili

---

## 2. Architecture (v2 — corrected after verification)

### Why not offscreen (the original v1 approach was overturned)
Verification found two hard constraints:
1. **`getUserMedia` for the camera fails inside an offscreen document** — offscreen documents are hidden, so the browser can't show the permission prompt (the `USER_MEDIA` reason only covers screen capture / tabCapture).
2. **MediaPipe's wasm needs `wasm-unsafe-eval`**, but the website's (YouTube's) page CSP blocks wasm injected into the page.

### v2: an "extension-origin iframe" injected into the page
The camera + MediaPipe live in an **iframe whose src points to the extension's own page `camera.html`** (exposed via `web_accessible_resources`). That iframe:
- is an **extension-origin** document → governed by the extension CSP (which includes `wasm-unsafe-eval`), so the wasm runs and the website CSP is **bypassed entirely**;
- is a **real, rendered (not display:none) document** + `allow="camera"` → `getUserMedia` can show the prompt, requested **as the extension, asked once, persisting across tabs**.

```
┌──────────── youtube.com / bilibili.com page ────────────┐
│                                                          │
│  content.js  (content script, isolated world, no page CSP)│
│   • locate the main <video> (MutationObserver waits)     │
│   • inject <iframe src="chrome-extension://…/camera.html"│
│             allow="camera"> (1×1, near-invisible, no hit)│
│   • run the gesture state machine + throttled currentTime│
│   • show a small auto-dismiss toast only on error        │
│           ▲ window 'message'         │ postMessage       │
│           │ {x, d, present}          │ (optional config) │
│  ┌────────┴──────────────────────────▼───────────────┐  │
│  │  iframe: camera.html + camera.js  (extension origin)│  │
│  │   • getUserMedia(camera) — allowed by extension CSP │  │
│  │   • MediaPipe HandLandmarker (local wasm + model)   │  │
│  │   • per frame: hand x (mirrored 0..1), pinch d, hand?│ │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**No service worker / background needed** (MV3 allows none), and no offscreen. Minimal set of components.

### Responsibility boundaries (single purpose, easy to test)
| Module | Single responsibility | Notes |
|--------|-----------------------|-------|
| `camera.js` (in the iframe) | Pure "gesture sensor": camera + MediaPipe → emit `{x, d, present}` per frame | Touches no video, makes no business decisions |
| `content.js` (content script) | Inject the iframe + run the gesture state machine + set `<video>.currentTime` | All decision logic lives here, unit-testable |
| `gesture-core.js` | Pure functions: state machine + smoothing + hysteresis (imported by content.js and by the tests) | No DOM dependency, pure logic |
| `manifest.json` | Permissions, injection rules, CSP, web_accessible_resources | — |

> Extracting the state machine into the DOM-free module `gesture-core.js` lets it be unit-tested directly with node, no browser needed.

---

## 3. Core algorithm: pinch → scrub

### Sensor output (camera.js, per frame)
MediaPipe HandLandmarker returns 21 normalized landmarks ([0,1]) per hand. We use:
- `landmark[4]` = thumb tip, `landmark[8]` = index tip
- `handX = mirror((x₄ + x₈) / 2) = 1 − (x₄ + x₈) / 2` (mirrored: hand to the user's right = video forward)
- `d = normalized euclidean distance(landmark[4], landmark[8])` (pinch closeness)
- `present = whether a hand was detected`
- Take only the highest-confidence hand (`numHands: 1`)

Posted to the parent window: `{ type:'gs-frame', x, d, present }`

### Decision (content.js + gesture-core.js, per frame)
```
smoothing: xSmooth = EMA(x, α=0.5)        // exponential moving average, de-jitter
hysteresis:
  IDLE → DRAGGING when d < 0.05
  DRAGGING → IDLE when d > 0.07

state IDLE:
  if present and d < 0.05:
    enter DRAGGING
    anchorX = xSmooth
    anchorFraction = clamp01(video.currentTime / video.duration)   // relative anchoring

state DRAGGING:
  each frame:
    Δ = xSmooth − anchorX
    target = clamp01(anchorFraction + Δ)         // full width Δ=±1 = whole video
    throttled (≤20/sec): video.currentTime = target × video.duration
  if !present or d > 0.07:
    return to IDLE (keep the current position)
```

### Key design points
- **Relative anchoring:** avoids "jumps the instant you pinch".
- **Mirroring:** done on the camera.js side, so content.js receives an intuitive x.
- **Hysteresis + EMA smoothing:** prevents bar jitter and false triggers.
- **Throttle:** `video.currentTime` writes capped at ≤20/sec.
- **duration guard:** skip the frame when `duration` is 0 / NaN / Infinity (live or not ready).

---

## 4. Tech stack & directory layout

### Tech stack
- **Manifest V3** Chrome extension, pure front-end, no build tool, no backend, no background.
- **`@mediapipe/tasks-vision` 0.10.35** `HandLandmarker`, `runningMode:"VIDEO"`, `detectForVideo()`, GPU delegate (CPU fallback).
- **Local** `hand_landmarker.task` model + wasm runtime (offline, privacy-safe).
- Plain JavaScript, ES modules.

### Key manifest fields
- `content_scripts`: match `*://*.youtube.com/*`, `*://*.bilibili.com/*`, inject `content.js`.
- `content_security_policy.extension_pages`: `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` (so camera.html can run the wasm).
- `web_accessible_resources`: expose `camera.html` to the two sites (so the page can iframe it; the lib/model it loads are same-origin subresources and don't need listing).
- `host_permissions`: the same two sites.
- Camera: **not a chrome permission** — obtained via the iframe's `getUserMedia` (extension origin, granted once).

### Directory (`C:\Project\GestureSeek`)
```
GestureSeek/
├── manifest.json
├── content.js                  ← in page: locate video + inject iframe + state machine + currentTime + error toast
├── gesture-core.js             ← pure logic: state machine / smoothing / thresholds (no DOM, unit-testable)
├── camera.html                 ← iframe document (extension origin)
├── camera.js                   ← in iframe: camera + MediaPipe → emit {x,d,present} per frame
├── lib/
│   ├── vision_bundle.mjs       ← @mediapipe/tasks-vision runtime (local)
│   └── wasm/                    ← MediaPipe wasm (local)
├── models/
│   └── hand_landmarker.task    ← model (local, 7.8MB)
├── icons/                      ← 16/32/48/128
├── tools/gen-icons.js          ← icon generator (dev only)
├── tests/gesture-core.test.js  ← state-machine unit tests (run with node, CommonJS)
├── README.md                   ← install & usage
└── docs/superpowers/specs/     ← this design doc
```

---

## 5. Edge cases & error handling

| Case | Handling |
|------|----------|
| No `<video>` / not loaded yet | `MutationObserver` waits for the video, then activates; also re-binds on SPA route changes |
| Camera busy / permission denied | camera.js catches the error → tells content.js → auto-dismiss toast, no spam |
| YouTube Trusted Types CSP (`require-trusted-types-for 'script'`) | content.js uses only `createElement` + property assignment + `textContent`, **never innerHTML/srcdoc** or other parser sinks |
| Multiple hands detected | `numHands:1`, take the highest confidence |
| Fullscreen playback | `<video>` is still accessible; the iframe is still in the DOM, works normally |
| `duration` is NaN/0/Infinity (live/not ready) | skip the seek that frame |
| YouTube SPA video switch (URL changes without reload) | listen for `yt-navigate-finish` / URL change, re-locate the `<video>` |
| Hand leaves the frame | `present=false` → exit DRAGGING, keep the current position |

---

## 6. Acceptance criteria
1. On a youtube.com video page, pinch and move right → the video moves forward live; release to stop.
2. Works the same on bilibili.com, sharing the same content.js / gesture-core.js.
3. The video does not jump at the instant of pinching (relative anchoring).
4. Hand to the user's right → video forward (mirroring correct).
5. Camera permission is asked once; afterwards both sites start automatically without prompting.
6. No image data is ever sent to any external server (fully local).
7. `tests/gesture-core.test.js` all green (state-machine logic, 24 cases incl. NaN/creep regressions).

---

## 7. Technical verification conclusions (2026-06-07, main-thread online verification)
| ID | Assumption | Conclusion |
|----|------------|-----------|
| A1 | offscreen can open the camera | ❌ **overturned** → use an extension-origin iframe (`allow="camera"`) |
| A2 | MediaPipe loads locally under the extension CSP | ✅ needs `script-src 'self' 'wasm-unsafe-eval'`; tasks-vision 0.10.35 works |
| A3 | landmark 4=thumb tip / 8=index tip, normalized [0,1] | ✅ |
| A4 | content script can set `<video>.currentTime` on YT/Bilibili | ✅ (wait for duration, guard NaN) |
| A5 | bypass the website CSP | ✅ extension-origin iframe under the extension CSP; content script in the isolated world |
| A6 | offscreen lifecycle | ⊘ obsolete (no offscreen / background anymore) |
| A7 | in-browser performance is sufficient | ✅ GPU delegate 30+ fps |
| new | do YT/Bilibili use `Permissions-Policy` to disable camera | ✅ measured: YouTube only restricts `ch-ua-*`, not camera; Bilibili sends no restriction header → `allow="camera"` delegation succeeds on both |

> Sources: chrome.offscreen official docs, chrome-extensions-samples #821, mediapipe #4028, Chrome CSP docs, MDN getUserMedia/Permissions-Policy, plus a live check of both sites' response headers.

---

## 8. Multi-agent code review & hardening (v2.1, 2026-06-07)

After the code was written, a 13-agent parallel adversarial review (0 blocker / 10 major / 9 minor / 12 nit) drove this hardening:

**Logic (gesture-core.js)**
- Fixed the EMA creep bug: on entering DRAGGING, snap the smoothed `xSmooth` to the raw `frame.x`, so "still hand after pinch → still video" (the original used the lagged smoothed value, which made the video creep forward tens of seconds).
- Full NaN guarding: non-finite `frame.x`/`d`/`currentTime` degrade safely; `clamp01(NaN)=0`; a NaN distance releases the drag instead of locking it.
- Added 6 regression tests for the above (24 total).

**Lifecycle (content.js)**
- **Activate only on video pages** (YouTube `/watch /shorts /embed /live`, Bilibili `/video /bangumi /list …`), to avoid the camera prompt on the home page and avoid locking onto a home-page preview `<video>`.
- **Site-agnostic SPA navigation:** poll `location.href` + `popstate` + YouTube's `yt-navigate-finish`; any change resets the state machine and re-picks the video (fixes Bilibili video switching).
- The MutationObserver is now persistent + debounced (300ms), so it can re-discover a player/iframe that appears or is replaced later; no more one-shot disconnect.
- `pickVideo` requires positive area, skips 0×0/hidden videos; the cache is also invalidated when the area drops to zero.
- Error toasts distinguish recoverable vs fatal (fatal = 12s).

**Sensor (camera.js)**
- USB camera unplugged mid-session (track `ended`) → report `camera-lost`.
- Consecutive inference failures accumulating ~2s → report `detect-failed` once, no more silent failure.

**Manifest (manifest.json)**
- `web_accessible_resources` narrowed to just `camera.html` (the rest are same-origin extension subresources, no need to expose); removed the redundant `host_permissions`; added `storage` (only for "show the first-run hint once").

---

## 9. v0.3.0: drag overlay + paused/fullscreen fixes (user-feedback driven)

User feedback: "want to see a progress bar while dragging / it works poorly when paused / it works poorly in fullscreen." Another focused 4-agent review (caught 1 blocker) drove these fixes:

- **Drag overlay:** while DRAGGING, show a progress bar + "current / total" above the video, hidden ~0.7s after release; built with `textContent`/`createElement` (Trusted-Types safe); positioned by the video rect (raised to clear the native control bar) in normal view, hosted inside the fullscreen element with `bottom%` positioning in fullscreen (to avoid transform mis-placement).
  > (Superseded in v0.4: the custom overlay was removed in favor of the site's native bar — see the play/pause design doc.)
- **Fullscreen fix (root cause):** camera.js used `requestAnimationFrame`, which is suspended while the iframe isn't painted in fullscreen → detection stopped. **Switched to a self-scheduling `setTimeout` timer**: in a foreground tab it keeps firing even when the iframe isn't painted, and the camera stream keeps producing frames → detection survives fullscreen. The iframe stays on `body` and is **never re-parented** (avoids the 1–3s camera-reload dead-zone, the blocker). Covers real fullscreen / Bilibili web-fullscreen / bare-`<video>` fullscreen.
- **Paused fix:** while paused, every `currentTime` write forces a frame decode; 20/sec stutters and lags behind. Switched to a **play-state-aware throttle** (50ms playing / 140ms paused) plus a **precise commit on release**. Seeking is logically independent of play state (dragging always worked while paused); the stutter was decode pressure, not a logic bug.
