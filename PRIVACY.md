# GesturePlay Privacy Policy

_Last updated: June 10, 2026_

GesturePlay is a browser extension that lets you control video playback on
youtube.com and bilibili.com with hand gestures, using your webcam.

## The short version

**GesturePlay collects no data. Nothing ever leaves your computer.**

## Camera

- GesturePlay uses your webcam only to detect hand gestures, and only on
  YouTube / Bilibili video pages while the extension is enabled.
- All video frames are processed **locally in your browser** by Google's
  MediaPipe hand-tracking model, which is bundled inside the extension.
- Camera frames are never recorded, stored, or transmitted anywhere. The
  extension makes **no network requests at all** — the AI model and runtime
  ship inside the package and work fully offline.

## What is stored

- Your settings (sensitivity sliders, language, on/off switch) are saved with
  `chrome.storage.sync`, which Chrome may sync across your own signed-in
  browsers. These are numbers and flags only — never any camera data.
- A single local flag remembers whether the first-run hint was already shown.

## What is NOT collected

- No analytics, no telemetry, no crash reporting.
- No personal information, no browsing history, no video-watching data.
- No cookies, no fingerprinting, no third-party services.

## Permissions explained

- **Access to youtube.com / bilibili.com** — needed to run the gesture
  controller on video pages and move the video's progress bar.
- **storage** — needed to save your settings.
- The camera permission is requested through the browser's standard prompt
  the first time the extension runs; you can revoke it at any time from the
  site permissions in your browser.

## Contact

Questions or concerns: open an issue at
https://github.com/Jimmyyu725/GesturePlay/issues
