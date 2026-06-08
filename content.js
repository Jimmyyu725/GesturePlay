// content.js — injected into youtube.com / bilibili.com (isolated world).
// Owns: deciding whether this is a video page, locating the <video>, injecting
// the camera iframe, running the gesture state machine, writing currentTime, and
// drawing the drag overlay (progress bar). All DOM writes avoid parser sinks
// (no innerHTML/srcdoc) so YouTube's Trusted Types CSP can't block us.
//
// Fullscreen note: detection survives fullscreen because camera.js drives its
// loop off a timer (not rAF), so the camera iframe can stay on <body> even when
// it isn't painted. Only the visible overlay needs to be hosted under the
// fullscreen element to be seen.
(function () {
  "use strict";

  const GC = globalThis.GestureCore;
  if (!GC) {
    console.error("[GestureSeek] gesture-core not loaded");
    return;
  }

  const machine = GC.createMachine();
  const SEEK_MS_PLAYING = 50; // <=20/sec: smooth scrub while playing
  const SEEK_MS_PAUSED = 140; // ~7/sec: paused video must decode each seek; don't flood it
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
  let wasDragging = false;
  let lastTarget = null;
  let firstRunHintChecked = false;

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

  // --- fullscreen host for the visible overlay -----------------------------
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
    // the camera track). A 2px near-transparent frame is enough.
    Object.assign(el.style, {
      position: "fixed",
      width: "2px",
      height: "2px",
      right: "0px",
      bottom: "0px",
      opacity: "0.01",
      border: "0",
      padding: "0",
      margin: "0",
      zIndex: "-2147483647",
      pointerEvents: "none",
    });
    (document.body || document.documentElement).appendChild(el);
    iframe = el;
  }

  function removeIframe() {
    if (iframe && iframe.isConnected) iframe.remove();
    iframe = null;
    machine.reset();
    wasDragging = false;
    lastTarget = null;
    hideOverlay();
  }

  // --- drag overlay (progress bar + time) ----------------------------------
  let ov = null;
  let ovFill = null;
  let ovLabel = null;
  let ovHideTimer = 0;

  function buildOverlay() {
    ov = document.createElement("div");
    Object.assign(ov.style, {
      position: "fixed",
      display: "none",
      alignItems: "center",
      gap: "12px",
      width: "min(560px, 72vw)",
      padding: "10px 16px",
      background: "rgba(18,18,24,0.86)",
      borderRadius: "12px",
      zIndex: "2147483647",
      pointerEvents: "none",
      boxShadow: "0 6px 24px rgba(0,0,0,.45)",
      boxSizing: "border-box",
      transform: "translateX(-50%)",
    });

    const track = document.createElement("div");
    Object.assign(track.style, {
      position: "relative",
      flex: "1",
      height: "6px",
      borderRadius: "3px",
      background: "rgba(255,255,255,0.28)",
      overflow: "hidden",
    });
    ovFill = document.createElement("div");
    Object.assign(ovFill.style, {
      position: "absolute",
      left: "0",
      top: "0",
      bottom: "0",
      width: "0%",
      borderRadius: "3px",
      background: "linear-gradient(90deg,#7c3aed,#2563eb)",
    });
    track.appendChild(ovFill);

    ovLabel = document.createElement("div");
    Object.assign(ovLabel.style, {
      color: "#fff",
      font: "600 13px/1 ui-monospace, monospace",
      whiteSpace: "nowrap",
      minWidth: "108px",
      textAlign: "right",
    });

    ov.appendChild(track);
    ov.appendChild(ovLabel);
  }

  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const p = function (n) {
      return n < 10 ? "0" + n : "" + n;
    };
    return h > 0 ? h + ":" + p(m) + ":" + p(ss) : m + ":" + p(ss);
  }

  function showOverlay(v, fraction, targetSec, durationSec) {
    if (!ov) buildOverlay();
    const fe = fsElement();
    if (fe && fe.tagName !== "VIDEO") {
      // Real fullscreen on a container: host inside it and position relative to
      // it (robust to any transform on the host; the host fills the screen).
      if (ov.parentElement !== fe) fe.appendChild(ov);
      ov.style.position = "absolute";
      ov.style.left = "50%";
      ov.style.top = "auto";
      ov.style.bottom = "12%";
    } else {
      // Normal layout (or CSS web-fullscreen / bare-video FS): host on body and
      // position over the video via its viewport rect.
      const host = document.body || document.documentElement;
      if (ov.parentElement !== host) host.appendChild(ov);
      const r = v.getBoundingClientRect();
      const lift = Math.max(72, r.height * 0.16); // clear the native control bar
      ov.style.position = "fixed";
      ov.style.left = Math.round(r.left + r.width / 2) + "px";
      ov.style.top = Math.round(r.top + r.height - lift) + "px";
      ov.style.bottom = "auto";
    }
    ov.style.display = "flex";
    ovFill.style.width = Math.round(GC.clamp01(fraction) * 100) + "%";
    ovLabel.textContent = fmt(targetSec) + " / " + fmt(durationSec);
    clearTimeout(ovHideTimer);
  }

  function hideOverlaySoon() {
    if (!ov || ov.style.display === "none") return;
    clearTimeout(ovHideTimer);
    ovHideTimer = setTimeout(hideOverlay, 700);
  }

  function hideOverlay() {
    clearTimeout(ovHideTimer);
    if (ov) ov.style.display = "none";
  }

  // --- per-frame handling --------------------------------------------------
  function onFrame(frame) {
    const v = getVideo();
    if (!v) return;
    const res = machine.update(frame, { currentTime: v.currentTime, duration: v.duration });

    if (res.state === "DRAGGING") {
      wasDragging = true;
      // Skip entry/transient frames (fraction null) to avoid a 0/0 overlay flicker.
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
        showOverlay(v, res.fraction, res.seekTo, v.duration);
      }
    } else {
      // Released: commit the final precise position (covers throttled-away last
      // write, important while paused), then hide the overlay.
      if (wasDragging && lastTarget != null) {
        try {
          v.currentTime = lastTarget;
        } catch (e) {}
      }
      wasDragging = false;
      lastTarget = null;
      hideOverlaySoon();
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
    toastEl.style.position = host === document.body || host === document.documentElement ? "fixed" : "absolute";
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
          toast("GestureSeek:即将请求摄像头权限,请点击「允许」(只问一次,画面仅本地处理、不上传)", 9000);
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
    }
    // gs-ready: nothing to do (no UI during normal use)
  });

  function handleError(m) {
    if (m.indexOf("camera-denied") === 0) {
      toast("GestureSeek:摄像头未授权。请点地址栏左侧的摄像头图标改为「允许」,然后刷新页面。", 12000);
    } else if (m.indexOf("camera-lost") === 0) {
      toast("GestureSeek:摄像头连接已断开,请重新连接后刷新页面。", 12000);
    } else if (m.indexOf("model-load-failed") === 0) {
      toast("GestureSeek:手势模型加载失败,请刷新页面重试。", 12000);
    } else if (m.indexOf("detect-failed") === 0) {
      toast("GestureSeek:手势识别异常,请刷新页面重试。", 12000);
    } else {
      toast("GestureSeek:初始化失败 — " + m, 10000);
    }
  }

  // --- lifecycle -----------------------------------------------------------
  function sync() {
    if (isVideoPage()) {
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
    hideOverlay();
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

  sync();
})();
