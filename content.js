// content.js — injected into youtube.com / bilibili.com (isolated world).
// Owns: deciding whether this is a video page, locating the <video>, injecting
// the camera iframe, running the gesture state machine, and writing currentTime.
// All DOM writes avoid parser sinks (no innerHTML/srcdoc) so YouTube's Trusted
// Types CSP can't block us.
(function () {
  "use strict";

  const GC = globalThis.GestureCore;
  if (!GC) {
    console.error("[GestureSeek] gesture-core not loaded");
    return;
  }

  const machine = GC.createMachine();
  const MIN_SEEK_MS = 50; // throttle currentTime writes to <=20/sec
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

  // --- camera iframe -------------------------------------------------------
  function ensureIframe() {
    if (iframe && iframe.isConnected) return;
    maybeShowFirstRunHint();
    const el = document.createElement("iframe");
    el.src = chrome.runtime.getURL("camera.html");
    el.setAttribute("allow", "camera");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("tabindex", "-1");
    el.setAttribute("title", "GestureSeek camera");
    // IMPORTANT: keep this rendered. Never switch to display:none or
    // visibility:hidden — that suspends the camera MediaStreamTrack and gestures
    // stop. A 2px, near-transparent, non-interactive frame keeps the track live.
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
  }

  // --- per-frame handling --------------------------------------------------
  function onFrame(frame) {
    const v = getVideo();
    if (!v) return;
    const res = machine.update(frame, { currentTime: v.currentTime, duration: v.duration });
    if (res.seekTo != null && GC.isFiniteNum(res.seekTo)) {
      const now = performance.now();
      if (now - lastSeekAt >= MIN_SEEK_MS) {
        try {
          v.currentTime = res.seekTo;
        } catch (e) {
          /* ignore transient seek errors */
        }
        lastSeekAt = now;
      }
    }
  }

  // --- toast (only on failure / first-run hint) ----------------------------
  let toastEl = null;
  let toastTimer = 0;
  function toast(text, ms) {
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement("div");
      Object.assign(toastEl.style, {
        position: "fixed",
        left: "50%",
        bottom: "84px",
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
      (document.body || document.documentElement).appendChild(toastEl);
    }
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
  // On a video page: ensure the camera iframe exists and a video is targeted.
  // Off a video page: tear the camera down (no camera prompt on home/feed).
  function sync() {
    if (isVideoPage()) {
      if (getVideo()) ensureIframe();
    } else {
      removeIframe();
      cachedVideo = null;
    }
  }

  // Debounced MutationObserver: handles videos/iframes that appear or are
  // swapped after load, without a per-mutation layout storm. Kept alive (never
  // permanently disconnected) so it re-detects late or replaced players.
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

  // Site-agnostic SPA navigation detection. Monkey-patching history from the
  // isolated world does NOT intercept the page's own pushState, so poll the URL
  // (cheap) and also honor popstate + YouTube's fast-path event.
  function onNavigate() {
    machine.reset();
    cachedVideo = null;
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
  window.addEventListener("yt-navigate-finish", onNavigate); // YouTube fast-path

  sync();
})();
