# Chrome Web Store Listing — copy-paste material

Everything below is ready to paste into the Chrome Web Store Developer
Dashboard (https://chrome.google.com/webstore/devconsole).

---

## Item name

```
GestureSeek — Hand Gesture Video Control
```

## Summary (max 132 chars)

English:

```
Control YouTube & Bilibili with webcam hand gestures: pinch to scrub the timeline, fist to play/pause. 100% local, no data leaves.
```

Chinese (add as a zh-CN localized listing in the dashboard if desired):

```
用摄像头手势控制 YouTube / B站:捏合拖动进度条,握拳切换播放/暂停。全程本地处理,绝不上传任何数据。
```

## Detailed description (English)

```
Control video playback without touching your mouse or keyboard — just your hand and your webcam.

GESTURES
• Pinch (thumb + index, with your other three fingers raised) and move your hand left/right to scrub the video timeline — the site's own progress bar follows live.
• Hold a fist (~half a second) to toggle play / pause.
• Open your palm or drop your hand to do nothing — it's the resting pose.

WORKS GREAT
• On youtube.com and bilibili.com video pages.
• While playing, while paused, and in fullscreen.
• Fine scrubbing by default: one full hand sweep = 1 minute (configurable: 30 s to 5 min, or the whole video).

TUNABLE
Click the toolbar icon for live-updating settings: master on/off switch, scrub range, start deadzone, fist hold time, fingers required, pinch sensitivity, English/中文 interface, and an optional camera preview with a hand-skeleton overlay for tuning.

PRIVATE BY DESIGN
All hand tracking runs locally in your browser using Google's MediaPipe model, which is bundled inside the extension. No video frame ever leaves your machine. The extension makes zero network requests: no analytics, no accounts, no servers. Privacy policy: https://github.com/Jimmyyu725/GestureSeek/blob/main/PRIVACY.md

REQUIREMENTS
A webcam (built-in or USB) and reasonable lighting. Camera permission is requested once on first use.
```

## Category

Suggested: **Accessibility** (alternative: Fun)

## Language

Primary: English. Optionally add a zh-CN localized description (above).

---

## Privacy tab — exact answers

- **Single purpose description:**
  "Control video playback (seek and play/pause) on YouTube and Bilibili using
  webcam hand gestures processed locally on the user's device."

- **Permission justifications:**
  - `storage` — "Stores the user's settings (sensitivity sliders, language,
    on/off switch) in chrome.storage.sync so they persist and roam with the
    Chrome profile."
  - Host access `*://*.youtube.com/*`, `*://*.bilibili.com/*` — "Injects the
    gesture controller content script on video pages of these two sites so
    detected gestures can move the video's playback position and toggle
    play/pause. The extension operates only on these sites."

- **Remote code:** No. All code and the AI model are bundled in the package;
  the extension makes no network requests.

- **Data usage disclosures:** check NOTHING is collected. (Camera frames are
  processed in memory locally and never stored or transmitted; settings are
  stored locally/synced by Chrome and contain no personal data.)

- **Privacy policy URL:** `https://github.com/Jimmyyu725/GestureSeek/blob/main/PRIVACY.md`
  (the repository must be public for reviewers to read it — either make the
  repo public, or paste PRIVACY.md into a public GitHub Gist and use that URL).

---

## Assets checklist

- [x] Icon 128×128 — already in the package (`icons/icon128.png`).
- [x] Screenshots (1280×800), ready to upload:
  - `assets/store/screenshot-1-gestures.png` — the at-a-glance gesture guide.
  - `assets/store/screenshot-2-scrub.png` — the scrubbing demo + feature chips.
  - Regenerate any time: gesture art via `tools/gen-gesture-art.mjs` (OpenAI
    Images API), then render `tools/store-shots/*.html` at 1280×800 with
    headless Chrome/Edge (`--headless=new --window-size=1280,800 --screenshot=...`).
  - (Optional extra) A real-usage capture: open a YouTube video, enable
    "Show camera preview + hand skeleton" in settings, pinch, Win+Shift+S.
- [ ] (Optional) Small promo tile 440×280 — can be skipped; the store will
  still accept the listing without marketing images in most cases.

---

## Submission steps (manual, ~15 minutes + review wait)

1. Register a Chrome Web Store developer account (one-time **$5**):
   https://chrome.google.com/webstore/devconsole
2. "New item" → upload `dist/GestureSeek-v<version>.zip`
   (build it with `powershell -ExecutionPolicy Bypass -File tools\pack.ps1`).
3. Paste the listing texts above; upload screenshot(s); pick the category.
4. Fill the Privacy tab with the exact answers above; set the privacy policy
   URL.
5. Visibility: choose **Unlisted** (installable via link only — good first
   release) or **Public**.
6. Submit for review. Extensions that use the camera and site access typically
   take a few days to review; you'll get an email either way.
