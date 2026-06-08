// camera.js — runs inside the extension-origin iframe (camera.html).
// Pure "gesture sensor": opens the webcam, runs MediaPipe HandLandmarker, and
// posts one lightweight {x, d, present} message per frame to the parent (the
// content script). It makes NO video/business decisions.
import { HandLandmarker, FilesetResolver } from "./lib/vision_bundle.mjs";

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

const TARGET_FPS = 30;
const MIN_FRAME_MS = 1000 / TARGET_FPS;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const DETECT_FAIL_LIMIT = 60; // ~2s of consecutive inference errors before warning

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

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("lib/wasm"));
  const baseOptions = {
    modelAssetPath: chrome.runtime.getURL("models/hand_landmarker.task"),
  };
  // Prefer GPU; fall back to CPU if the GPU delegate fails to initialise.
  try {
    return await HandLandmarker.createFromOptions(fileset, {
      baseOptions: Object.assign({ delegate: "GPU" }, baseOptions),
      runningMode: "VIDEO",
      numHands: 1,
    });
  } catch (gpuErr) {
    return await HandLandmarker.createFromOptions(fileset, {
      baseOptions: Object.assign({ delegate: "CPU" }, baseOptions),
      runningMode: "VIDEO",
      numHands: 1,
    });
  }
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
  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    /* autoplay of a muted local stream is allowed; ignore */
  }

  let landmarker;
  try {
    landmarker = await createLandmarker();
  } catch (e) {
    post({ type: "gs-error", message: "model-load-failed:" + (e && e.message ? e.message : "unknown") });
    return;
  }

  post({ type: "gs-ready" });

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
      res = landmarker.detectForVideo(video, ts);
      failStreak = 0;
    } catch (e) {
      failStreak++;
      if (failStreak >= DETECT_FAIL_LIMIT && !detectErrorPosted) {
        detectErrorPosted = true;
        post({ type: "gs-error", message: "detect-failed:" + (e && e.message ? e.message : "unknown") });
      }
      return;
    }

    if (res && res.landmarks && res.landmarks.length > 0) {
      const lm = res.landmarks[0];
      const t = lm[THUMB_TIP];
      const i = lm[INDEX_TIP];
      const cx = (t.x + i.x) / 2;
      const x = 1 - cx; // mirror: hand to user's right => later in video
      const dz = (t.z || 0) - (i.z || 0);
      const d = Math.sqrt((t.x - i.x) ** 2 + (t.y - i.y) ** 2 + dz ** 2);
      post({ type: "gs-frame", x: x, d: d, present: true });
    } else {
      post({ type: "gs-frame", x: 0, d: 1, present: false });
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
