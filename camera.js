// camera.js — runs inside the extension-origin iframe (camera.html).
// Pure "gesture sensor": opens the webcam, runs MediaPipe HandLandmarker, and
// posts one lightweight {x, d, present} message per frame to the parent (the
// content script). It makes NO video/business decisions.
import { HandLandmarker, GestureRecognizer, FilesetResolver } from "./lib/vision_bundle.mjs";

// Silence two known-benign MediaPipe glog WARNINGS that emscripten routes to
// console.error — they surface in chrome://extensions as "errors" and alarm
// users, but do not affect hand tracking. Everything else passes through, so
// real errors stay visible.
(function () {
  const NOISE = [
    "OpenGL error checking is disabled",
    "NORM_RECT without IMAGE_DIMENSIONS",
    "gl_context.cc",
    "landmark_projection_calculator.cc",
  ];
  function wrap(orig) {
    return function () {
      try {
        const s = arguments.length ? String(arguments[0]) : "";
        for (let k = 0; k < NOISE.length; k++) if (s.indexOf(NOISE[k]) >= 0) return;
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  }
  function isNoise(msg) {
    try {
      const s = String(msg);
      for (let k = 0; k < NOISE.length; k++) if (s.indexOf(NOISE[k]) >= 0) return true;
    } catch (e) {}
    return false;
  }
  if (typeof console !== "undefined") {
    if (console.error) console.error = wrap(console.error);
    if (console.warn) console.warn = wrap(console.warn);
  }
  // Belt-and-suspenders: emscripten's logger checks a global `dbg` first
  // (if (typeof dbg !== "undefined") dbg(...)) before falling back to
  // console.warn. Define a filtering `dbg` so the noise is dropped at the source.
  try {
    if (typeof window !== "undefined" && typeof window.dbg === "undefined") {
      window.dbg = function (msg) {
        if (isNoise(msg)) return;
        try {
          console.warn(msg);
        } catch (e) {}
      };
    }
  } catch (e) {}
})();

// Detection engine:
//   "gesture"    = MediaPipe GestureRecognizer (gesture_recognizer.task) — gives
//                  21 landmarks (for pinch) PLUS a trained gesture label so a fist
//                  is recognized reliably as "Closed_Fist". (default)
//   "landmarker" = MediaPipe HandLandmarker (hand_landmarker.task) — landmarks
//                  only; pinch works, no fist. Retained as a fallback; flip here.
const ENGINE = "gesture";

const TARGET_FPS = 30;
const MIN_FRAME_MS = 1000 / TARGET_FPS;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
// [tip, pip] landmark pairs for middle / ring / pinky (used to tell extended vs curled)
const SIDE_FINGERS = [[12, 10], [16, 14], [20, 18]];
const DETECT_FAIL_LIMIT = 60; // ~2s of consecutive inference errors before warning
// 21-point hand skeleton edges (for the optional debug preview)
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

// Debug preview toggle, driven by content.js (popup setting).
let previewOn = false;
window.addEventListener("message", function (e) {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (m && m.type === "gs-preview") previewOn = !!m.on;
});

function post(msg) {
  try {
    parent.postMessage(msg, "*");
  } catch (e) {
    /* parent gone */
  }
}

async function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

async function createDetector() {
  const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("lib/wasm"));
  const isGesture = ENGINE === "gesture";
  const Cls = isGesture ? GestureRecognizer : HandLandmarker;
  const modelPath = chrome.runtime.getURL(
    isGesture ? "models/gesture_recognizer.task" : "models/hand_landmarker.task"
  );
  function make(delegate) {
    return Cls.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate: delegate },
      runningMode: "VIDEO",
      numHands: 1,
    });
  }
  // Prefer GPU; fall back to CPU if the GPU delegate fails to initialise.
  try {
    return await make("GPU");
  } catch (gpuErr) {
    return await make("CPU");
  }
}

// Pull {landmarks, fist} out of a per-frame result for either engine.
function readResult(res) {
  const lms = res && res.landmarks && res.landmarks.length > 0 ? res.landmarks[0] : null;
  let fist = false;
  if (ENGINE === "gesture" && res && res.gestures && res.gestures.length > 0 && res.gestures[0].length > 0) {
    fist = res.gestures[0][0].categoryName === "Closed_Fist";
  }
  return { landmarks: lms, fist: fist };
}

// How many of {middle, ring, pinky} are extended: a finger is extended when its
// tip is farther from the wrist than its PIP joint. Used to require a deliberate
// "pinch with the other three fingers up" pose before scrubbing (cuts false hits).
function dist2(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function countExtendedSideFingers(lm) {
  const w = lm[WRIST];
  let n = 0;
  for (let k = 0; k < SIDE_FINGERS.length; k++) {
    const tip = lm[SIDE_FINGERS[k][0]];
    const pip = lm[SIDE_FINGERS[k][1]];
    if (dist2(tip, w) > dist2(pip, w)) n++;
  }
  return n;
}

async function main() {
  let stream;
  try {
    stream = await openCamera();
  } catch (e) {
    post({ type: "gs-error", message: "camera-denied:" + (e && e.name ? e.name : "unknown") });
    return;
  }

  // Surface a lost camera (USB unplugged / grabbed by another app / revoked).
  let cameraLostPosted = false;
  const track = stream.getVideoTracks()[0];
  if (track) {
    track.addEventListener("ended", function () {
      if (!cameraLostPosted) {
        cameraLostPosted = true;
        post({ type: "gs-error", message: "camera-lost" });
      }
    });
  }

  const video = document.getElementById("cam");
  const previewCanvas = document.getElementById("preview");
  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    /* autoplay of a muted local stream is allowed; ignore */
  }

  let detector;
  try {
    detector = await createDetector();
  } catch (e) {
    post({ type: "gs-error", message: "model-load-failed:" + (e && e.message ? e.message : "unknown") });
    return;
  }

  post({ type: "gs-ready" });

  // Optional debug preview: mirrored webcam + hand skeleton, drawn only when the
  // user enables it (the iframe is resized to be visible by content.js).
  function drawPreview(lms) {
    const c = previewCanvas;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w, 0);
    ctx.scale(-1, 1); // selfie mirror, matches how the gesture x is mirrored
    try {
      ctx.drawImage(video, 0, 0, w, h);
    } catch (e) {
      /* video not ready */
    }
    if (lms) {
      ctx.strokeStyle = "#00e676";
      ctx.lineWidth = 2;
      for (let k = 0; k < HAND_CONNECTIONS.length; k++) {
        const a = lms[HAND_CONNECTIONS[k][0]];
        const b = lms[HAND_CONNECTIONS[k][1]];
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
      ctx.fillStyle = "#ff5252";
      for (let k = 0; k < lms.length; k++) {
        ctx.beginPath();
        ctx.arc(lms[k].x * w, lms[k].y * h, 3, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  let lastTs = -1;
  let failStreak = 0;
  let detectErrorPosted = false;

  // Use a self-scheduling timer (NOT requestAnimationFrame). rAF callbacks are
  // suspended when this iframe is not being painted — which happens whenever the
  // host page enters real fullscreen on an element that doesn't contain this
  // iframe. A timer keeps firing in the foreground tab regardless of paint, and
  // the live camera MediaStream keeps producing frames, so detection survives
  // fullscreen without relocating/reloading the iframe.
  function processFrame() {
    if (video.readyState < 2) return;

    // detectForVideo requires strictly increasing timestamps.
    let ts = performance.now();
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;

    let res = null;
    try {
      res = ENGINE === "gesture" ? detector.recognizeForVideo(video, ts) : detector.detectForVideo(video, ts);
      failStreak = 0;
    } catch (e) {
      failStreak++;
      if (failStreak >= DETECT_FAIL_LIMIT && !detectErrorPosted) {
        detectErrorPosted = true;
        post({ type: "gs-error", message: "detect-failed:" + (e && e.message ? e.message : "unknown") });
      }
      return;
    }

    const parsed = readResult(res);
    if (previewOn) drawPreview(parsed.landmarks);
    if (parsed.landmarks) {
      const lm = parsed.landmarks;
      const t = lm[THUMB_TIP];
      const i = lm[INDEX_TIP];
      const cx = (t.x + i.x) / 2;
      const x = 1 - cx; // mirror: hand to user's right => later in video
      const dz = (t.z || 0) - (i.z || 0);
      const d = Math.sqrt((t.x - i.x) ** 2 + (t.y - i.y) ** 2 + dz ** 2);
      const ext = countExtendedSideFingers(lm);
      post({ type: "gs-frame", x: x, d: d, present: true, fist: parsed.fist, ext: ext });
    } else {
      post({ type: "gs-frame", x: 0, d: 1, present: false, fist: false, ext: 0 });
    }
  }

  function tick() {
    try {
      processFrame();
    } catch (e) {
      /* never let one bad frame stop the loop */
    }
    setTimeout(tick, MIN_FRAME_MS);
  }
  tick();
}

main();
