# GestureSeek

Control YouTube and Bilibili with **webcam hand gestures**: **pinch and drag to scrub** the progress bar, **make a fist to play/pause**.

- **Pinch** thumb + index together **with your middle, ring and pinky raised** = grab the progress bar → move your hand left/right to scrub → release to drop it. Hand to the right = forward; sweeping the full camera width = the whole video. (The three raised fingers are required so everyday hand poses don't trigger it by accident.)
- ✊ **Hold a fist for about half a second** = toggle play/pause (fist again to toggle back). An open palm is the resting pose and does nothing.

Everything runs locally (MediaPipe hand detection on your GPU). **The webcam image never leaves your machine.**

While dragging, the site's **own native progress bar** moves (GestureSeek draws no bar of its own). Works while playing, paused, and in fullscreen.

---

## Install (load unpacked)

First get the files: clone or download this repository to any folder.

```bash
git clone <this-repo-url> GestureSeek
```

Then:

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the project folder — the one that contains `manifest.json` (wherever you cloned/downloaded it).
5. **GestureSeek** appears in the list — installed.

> Works on any Chromium-based browser (Chrome / Edge), on Windows, macOS, and Linux. Manifest V3. On macOS, also allow Chrome to use the camera under System Settings → Privacy & Security → Camera.

## First run

1. Open any **YouTube** or **Bilibili** video page.
2. The browser asks for **camera permission** (as "GestureSeek"). Click **Allow**.
   - Asked only once; it then works on both sites automatically.
   - If it didn't ask, or you denied it: click the camera icon on the left of the address bar, set it to Allow, then reload the page.
3. Hold your hand up to the webcam and **pinch + raise three fingers, then move** to scrub.

## Gestures

| Action | Effect |
|--------|--------|
| Pinch (thumb tip to index tip) **+ middle/ring/pinky raised** | Grab the progress bar (three fingers up prevents accidental triggers) |
| Hold pinch, move hand right | Seek forward |
| Hold pinch, move hand left | Seek backward |
| Release the pinch | Drop it, stay at the current spot |
| ✊ Hold a fist ~0.5s | Toggle play / pause (fist again to toggle back) |
| Open palm / hand out of frame | Resting pose, does nothing |

Sensitivity: **the full camera width = the whole video**, so short videos are very sensitive and long videos jump far with one sweep.

Start deadzone: small wobble right after pinching does **not** move the bar; scrubbing begins only once your hand has moved past a threshold (so it doesn't twitch the instant you pinch).

## Settings

Click the GestureSeek toolbar icon to open the popup. All sliders apply **live**:

- **Language** — Auto (follow the browser), 中文, or English; switches both the popup and the in-page messages.
- **Start deadzone** — how far the hand must move before scrubbing begins (higher = steadier).
- **Fist hold time** — how long a fist must be held to toggle play/pause.
- **Fingers required to scrub** — 3 (fewest false triggers), 2 (easier to pose), or 1 (loosest).
- **Pinch sensitivity** — thumb-to-index distance that counts as a pinch.
- **Show camera preview + hand skeleton** — a small corner window showing the detected hand; handy while tuning, turn it off afterwards.

## How it works

```
youtube.com / bilibili.com page
 └─ content.js (content script, isolated world)
     ├─ locate the main <video>, inject an extension-origin <iframe> (camera.html)
     ├─ run the pinch state machine (gesture-core.js)
     ├─ write video.currentTime to scrub (throttled), call video.play()/pause()
     └─ read settings from chrome.storage; show errors via a small toast only
   camera.html / camera.js (iframe, extension origin)
     ├─ getUserMedia (camera) — extension origin, granted once, works on both sites
     ├─ MediaPipe GestureRecognizer (local wasm + model; bypasses the page CSP)
     └─ per frame, post {x (mirrored), pinch distance, fingers up, fist} to content.js
```

- **Why an iframe (not an offscreen document):** offscreen documents can't open the camera (they're hidden, so the permission prompt can't show). An extension-origin iframe is both a visible document (camera can be granted) and runs under the extension CSP (which allows the MediaPipe wasm).
- **Engine:** MediaPipe **GestureRecognizer** gives the 21 hand landmarks (used for the pinch) plus a trained gesture label (`Closed_Fist`, used for play/pause). The older **HandLandmarker** is kept as a fallback — flip the `ENGINE` constant at the top of `camera.js`.
- **Privacy:** the MediaPipe runtime and model are bundled locally (`lib/`, `models/`). There are no network requests; the webcam image never leaves the machine.

## Development

```bash
node tests/gesture-core.test.js   # run the state-machine unit tests
node tools/gen-icons.js           # regenerate the icons
```

Design docs: `docs/superpowers/specs/`.

## Known limitations

- Only youtube.com and bilibili.com.
- Needs a USB / built-in webcam and enough light for MediaPipe to see the hand.
- Live streams (no fixed duration) can't be scrubbed; play/pause still works.
