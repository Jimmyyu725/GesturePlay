// content.js — injected into youtube.com / bilibili.com (isolated world).
// Owns: deciding whether this is a video page, locating the <video>, injecting
// the camera iframe, running the gesture state machine, and writing currentTime.
// It draws NO UI of its own: scrubbing moves the site's OWN native progress bar
// (because we set video.currentTime), and during a drag we nudge the player so
// the native controls stay visible. All DOM writes avoid parser sinks.
//
// Detection survives fullscreen because camera.js drives its loop off a timer
// (not rAF), so the camera iframe can stay on <body> even when not painted.
(function () {
  "use strict";

  const GC = globalThis.GestureCore;
  if (!GC) {
    console.error("[GestureSeek] gesture-core not loaded");
    return;
  }

  const I18N = globalThis.GSI18N;
  let lang = I18N ? I18N.resolve("auto") : "en"; // updated from the gsLang setting
  function tr(key) {
    return I18N ? I18N.t(lang, key) : key;
  }

  let machine = GC.createMachine(); // recreated when settings change
  const SEEK_MS_PLAYING = 50; // <=20/sec: smooth scrub while playing
  const SEEK_MS_PAUSED = 140; // ~7/sec: paused video must decode each seek; don't flood it
  const NUDGE_MS = 500; // how often to reveal native controls during a drag
  const EXT_ORIGIN = (function () {
    try {
      return new URL(chrome.runtime.getURL("")).origin;
    } catch (e) {
      return null;
    }
  })();

  let iframe = null;
  let cachedVideo = null;
  let lastSeekAt = 0;
  let lastNudgeAt = 0;
  let wasDragging = false;
  let lastTarget = null;
  let firstRunHintChecked = false;
  let previewOn = false; // debug camera/skeleton preview (popup setting)

  // --- settings (popup -> chrome.storage.sync -> here) ---------------------
  // Settings live in chrome.storage.sync so they roam with the browser profile
  // across machines. The one-time first-run hint stays in storage.local on
  // purpose (camera permission is per-device, so the hint should be too).
  const SETTINGS_DEFAULTS = {
    gsEnabled: true,
    gsDeadzone: 0.05,
    gsHold: 0.35,
    gsFingers: 3,
    gsPinch: 0.05,
    gsPreview: false,
    gsLang: "auto",
  };

  // One-time migration of pre-v0.8 settings from storage.local to storage.sync.
  function migrateLocalToSync(done) {
    try {
      chrome.storage.sync.get({ gsMigrated: false }, function (flag) {
        if (flag && flag.gsMigrated) return done();
        chrome.storage.local.get(
          ["gsDeadzone", "gsHold", "gsFingers", "gsPinch", "gsPreview", "gsLang"],
          function (old) {
            const carried = { gsMigrated: true };
            for (const k in old) if (old[k] !== undefined) carried[k] = old[k];
            chrome.storage.sync.set(carried, done);
          }
        );
      });
    } catch (e) {
      done();
    }
  }

  // Rebuild the gesture machine from the tuning settings. Only call this when a
  // gesture-affecting key actually changed — recreating the machine resets any
  // in-progress drag/fist, so we must NOT do it for the preview toggle alone.
  function applyMachine(s) {
    const pinchOn = typeof s.gsPinch === "number" ? s.gsPinch : 0.05;
    machine = GC.createMachine({
      deadzone: typeof s.gsDeadzone === "number" ? s.gsDeadzone : 0.05,
      holdMs: Math.max(50, Math.round((typeof s.gsHold === "number" ? s.gsHold : 0.35) * 1000)),
      requiredFingers: typeof s.gsFingers === "number" ? s.gsFingers : 3,
      pinchOn: pinchOn,
      pinchOff: pinchOn + 0.02,
    });
  }

  // Pure UI: show/hide the preview window. Does NOT touch the gesture machine.
  function applyPreview(s) {
    previewOn = !!s.gsPreview;
    sizeIframe();
    postPreview();
  }

  // Language for the in-page toasts (auto | zh | en).
  function applyLang(s) {
    lang = I18N ? I18N.resolve(s.gsLang) : "en";
  }

  // Master switch: off tears the camera down entirely; on re-activates.
  let enabled = true;
  function applyEnabled(s) {
    enabled = s.gsEnabled !== false;
    sync();
  }

  function loadSettings(cb) {
    try {
      chrome.storage.sync.get(SETTINGS_DEFAULTS, function (s) {
        cb(Object.assign({}, SETTINGS_DEFAULTS, s));
      });
    } catch (e) {
      /* storage unavailable */
    }
  }

  // --- which pages should activate -----------------------------------------
  function isVideoPage() {
    const h = location.hostname;
    const p = location.pathname;
    if (h.indexOf("youtube.com") >= 0) {
      return (
        p.indexOf("/watch") === 0 ||
        p.indexOf("/shorts/") === 0 ||
        p.indexOf("/embed/") === 0 ||
        p.indexOf("/live/") === 0
      );
    }
    if (h.indexOf("bilibili.com") >= 0) {
      return (
        p.indexOf("/video/") === 0 ||
        p.indexOf("/bangumi/") === 0 ||
        p.indexOf("/list/") === 0 ||
        p.indexOf("/cheese/") === 0 ||
        p.indexOf("/medialist/") === 0 ||
        p.indexOf("/festival/") === 0 ||
        p.indexOf("/blackboard/") >= 0
      );
    }
    return false;
  }

  // --- fullscreen host for the (failure-only) toast ------------------------
  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  // --- video targeting -----------------------------------------------------
  function area(v) {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  }

  function pickVideo() {
    const vids = document.querySelectorAll("video");
    let best = null;
    let bestArea = 0; // require positive area: ignore 0x0/hidden/preview videos
    for (let k = 0; k < vids.length; k++) {
      const v = vids[k];
      if (!v.isConnected) continue;
      const a = area(v);
      if (a > bestArea) {
        bestArea = a;
        best = v;
      }
    }
    return best;
  }

  function getVideo() {
    if (cachedVideo && cachedVideo.isConnected && area(cachedVideo) > 0) {
      return cachedVideo;
    }
    cachedVideo = pickVideo();
    return cachedVideo;
  }

  // --- camera iframe (lives on <body>; detection is paint-independent) ------
  function ensureIframe() {
    if (iframe && iframe.isConnected) return;
    maybeShowFirstRunHint();
    const el = document.createElement("iframe");
    el.src = chrome.runtime.getURL("camera.html");
    el.setAttribute("allow", "camera");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("tabindex", "-1");
    el.setAttribute("title", "GestureSeek camera");
    // Keep it rendered (NOT display:none/visibility:hidden — that would suspend
    // the camera track). Size/opacity are set by sizeIframe() (tiny when hidden,
    // a visible corner window when the debug preview is on).
    Object.assign(el.style, {
      position: "fixed",
      border: "0",
      padding: "0",
      margin: "0",
      pointerEvents: "none",
    });
    (document.body || document.documentElement).appendChild(el);
    iframe = el;
    sizeIframe();
  }

  // Tiny & invisible normally; a visible 240x180 corner window when preview is on.
  function sizeIframe() {
    if (!iframe) return;
    if (previewOn) {
      Object.assign(iframe.style, {
        width: "240px",
        height: "180px",
        right: "12px",
        bottom: "12px",
        opacity: "1",
        borderRadius: "10px",
        boxShadow: "0 6px 20px rgba(0,0,0,.45)",
        zIndex: "2147483646",
      });
    } else {
      Object.assign(iframe.style, {
        width: "2px",
        height: "2px",
        right: "0px",
        bottom: "0px",
        opacity: "0.01",
        borderRadius: "0",
        boxShadow: "none",
        zIndex: "-2147483647",
      });
    }
  }

  function postPreview() {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ type: "gs-preview", on: previewOn }, EXT_ORIGIN || "*");
    } catch (e) {
      /* iframe not ready yet; gs-ready will trigger a resend */
    }
  }

  function removeIframe() {
    if (iframe && iframe.isConnected) iframe.remove();
    iframe = null;
    machine.reset();
    wasDragging = false;
    lastTarget = null;
  }

  // --- reveal the site's NATIVE controls (so its own progress bar shows) ----
  // YouTube/Bilibili auto-hide controls while playing; a synthetic mousemove
  // over the player keeps the native progress bar + time visible during a drag,
  // so the user sees the site's OWN bar move (we add no bar of our own).
  function nudgeControls(v) {
    const now = performance.now();
    if (now - lastNudgeAt < NUDGE_MS) return;
    lastNudgeAt = now;
    try {
      const r = v.getBoundingClientRect();
      const ev = new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      });
      v.dispatchEvent(ev);
    } catch (e) {
      /* ignore */
    }
  }

  // --- per-frame handling --------------------------------------------------
  function onFrame(frame) {
    const v = getVideo();
    if (!v) return;
    const res = machine.update(frame, { currentTime: v.currentTime, duration: v.duration }, performance.now());

    // Fist held -> toggle play/pause (native UI shows the play/pause animation).
    if (res.togglePlay) {
      try {
        if (v.paused) {
          const p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          v.pause();
        }
      } catch (e) {
        /* ignore */
      }
      nudgeControls(v);
    }

    if (res.state === "DRAGGING") {
      wasDragging = true;
      if (res.fraction != null && res.seekTo != null && GC.isFiniteNum(res.seekTo)) {
        lastTarget = res.seekTo;
        const throttle = v.paused ? SEEK_MS_PAUSED : SEEK_MS_PLAYING;
        const now = performance.now();
        if (now - lastSeekAt >= throttle) {
          try {
            v.currentTime = res.seekTo;
          } catch (e) {
            /* ignore transient seek errors */
          }
          lastSeekAt = now;
        }
        nudgeControls(v); // keep the native progress bar visible while dragging
      }
    } else {
      // Released: commit the final precise position (covers throttled-away last
      // write, important while paused).
      if (wasDragging && lastTarget != null) {
        try {
          v.currentTime = lastTarget;
        } catch (e) {}
      }
      wasDragging = false;
      lastTarget = null;
    }
  }

  // --- toast (only on failure / first-run hint) ----------------------------
  let toastEl = null;
  let toastTimer = 0;
  function toast(text, ms) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      Object.assign(toastEl.style, {
        position: "fixed",
        left: "50%",
        bottom: "12%",
        transform: "translateX(-50%)",
        background: "rgba(20,20,25,0.92)",
        color: "#fff",
        font: "13px/1.5 system-ui, sans-serif",
        padding: "9px 15px",
        borderRadius: "9px",
        zIndex: "2147483647",
        pointerEvents: "none",
        maxWidth: "80vw",
        textAlign: "center",
        boxShadow: "0 4px 16px rgba(0,0,0,.4)",
      });
    }
    // Host under the fullscreen element so errors are visible in fullscreen too.
    const fe = fsElement();
    const host = fe && fe.tagName !== "VIDEO" ? fe : document.body || document.documentElement;
    if (toastEl.parentElement !== host) host.appendChild(toastEl);
    toastEl.style.position = host === (document.body || document.documentElement) ? "fixed" : "absolute";
    toastEl.textContent = text; // textContent is Trusted-Types safe
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) toastEl.style.display = "none";
    }, ms || 5000);
  }

  function maybeShowFirstRunHint() {
    if (firstRunHintChecked) return;
    firstRunHintChecked = true;
    try {
      chrome.storage.local.get("gsHintShown", function (r) {
        if (!r || !r.gsHintShown) {
          toast(tr("hint"), 9000);
          try {
            chrome.storage.local.set({ gsHintShown: true });
          } catch (e) {}
        }
      });
    } catch (e) {
      /* storage unavailable; skip the hint */
    }
  }

  // --- message bridge from the camera iframe -------------------------------
  window.addEventListener("message", function (e) {
    if (!iframe || e.source !== iframe.contentWindow) return;
    if (EXT_ORIGIN && e.origin !== EXT_ORIGIN) return;
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "gs-frame") {
      onFrame(msg);
    } else if (msg.type === "gs-error") {
      handleError(String(msg.message || ""));
    } else if (msg.type === "gs-ready") {
      postPreview(); // iframe is now listening; send the current preview state
    }
  });

  function handleError(m) {
    if (m.indexOf("camera-denied") === 0) {
      toast(tr("cameraDenied"), 12000);
    } else if (m.indexOf("camera-lost") === 0) {
      toast(tr("cameraLost"), 12000);
    } else if (m.indexOf("model-load-failed") === 0) {
      toast(tr("modelFail"), 12000);
    } else if (m.indexOf("detect-failed") === 0) {
      toast(tr("detectFail"), 12000);
    } else {
      toast(tr("initFail") + m, 10000);
    }
  }

  // --- lifecycle -----------------------------------------------------------
  function sync() {
    if (enabled && isVideoPage()) {
      if (getVideo()) ensureIframe();
    } else {
      removeIframe();
      cachedVideo = null;
    }
  }

  let syncScheduled = false;
  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    setTimeout(function () {
      syncScheduled = false;
      sync();
    }, 300);
  }
  const mo = new MutationObserver(scheduleSync);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Site-agnostic SPA navigation detection (history patching from the isolated
  // world cannot see the page's pushState, so poll the URL + honor popstate +
  // YouTube's fast-path event).
  function onNavigate() {
    machine.reset();
    cachedVideo = null;
    wasDragging = false;
    lastTarget = null;
    sync();
  }
  let lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onNavigate();
    }
  }, 700);
  window.addEventListener("popstate", onNavigate);
  window.addEventListener("yt-navigate-finish", onNavigate);

  // Settings: load now, and re-apply live whenever the popup changes them.
  migrateLocalToSync(function () {
    loadSettings(function (s) {
      applyMachine(s);
      applyPreview(s);
      applyLang(s);
      applyEnabled(s);
    });
  });
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") return;
      // Only rebuild the machine for gesture-affecting keys (preserves any
      // in-progress gesture when the user just flips the preview toggle).
      if (changes.gsDeadzone || changes.gsHold || changes.gsFingers || changes.gsPinch) {
        loadSettings(applyMachine);
      }
      if (changes.gsPreview) {
        loadSettings(applyPreview);
      }
      if (changes.gsLang) {
        loadSettings(applyLang);
      }
      if (changes.gsEnabled) {
        loadSettings(applyEnabled);
      }
    });
  } catch (e) {
    /* storage unavailable */
  }

  sync();
})();
