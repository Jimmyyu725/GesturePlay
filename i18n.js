// i18n.js — UI string table shared by the popup and the content script.
// Code, comments and keys are English; only the localized VALUES carry other
// languages (this is localization data, the user-facing translation feature).
// Exposes globalThis.GSI18N = { dict, resolve(stored), t(lang, key) }.
(function (root) {
  "use strict";

  const dict = {
    en: {
      labEnabled: "Enable GesturePlay",
      hintEnabled: "Off stops the camera and all gestures.",
      summary1: "Pinch + middle/ring/pinky up → scrub; move right = forward.",
      summary2: "✊ Hold a fist → toggle play / pause.",
      secSensitivity: "Sensitivity (applies live)",
      labDeadzone: "Start deadzone (move before scrubbing)",
      hintDeadzone: "Higher = steadier (less jitter); lower = more sensitive.",
      labHold: "Fist hold time (seconds)",
      hintHold: "How long to hold a fist before it toggles play/pause.",
      labFingers: "Fingers required to scrub",
      hintFingers: "3 = fewest false triggers; 2 = easier to pose; 1 = loosest.",
      labPinch: "Pinch sensitivity (smaller = pinch tighter)",
      hintPinch: "Thumb-to-index distance below this counts as a pinch.",
      labRange: "Scrub range (one full hand sweep)",
      hintRange: "Smaller = finer control. 'Whole video' sweeps across everything (old behavior).",
      range30s: "30 seconds",
      range1m: "1 minute",
      range2m: "2 minutes",
      range5m: "5 minutes",
      rangeWhole: "Whole video",
      secDebug: "Debug",
      labPreview: "Show camera preview + hand skeleton",
      hintPreview: "Shows a small corner window of the detected hand; turn it off once tuned.",
      secLanguage: "Language",
      langAuto: "Auto (follow browser)",
      reset: "Reset to defaults",
      // in-page toasts
      hint: "GesturePlay: about to request camera access — click Allow (asked once; video is processed locally and never uploaded)",
      cameraDenied: "GesturePlay: camera blocked. Click the camera icon on the left of the address bar, set it to Allow, then reload the page.",
      cameraLost: "GesturePlay: camera disconnected. Reconnect it, then reload the page.",
      modelFail: "GesturePlay: failed to load the hand model. Reload the page to try again.",
      detectFail: "GesturePlay: hand detection error. Reload the page to try again.",
      initFail: "GesturePlay: initialization failed — ",
    },
    zh: {
      labEnabled: "启用 GesturePlay",
      hintEnabled: "关闭后摄像头与所有手势全部停用。",
      summary1: "捏合 + 中/无名/小指竖起 → 拖进度;手往右 = 前进。",
      summary2: "✊ 握拳保持 → 切换 播放 / 暂停。",
      secSensitivity: "灵敏度(实时生效)",
      labDeadzone: "起步死区(手要移动多远才开始拖)",
      hintDeadzone: "越大越稳(更不易抖);越小越灵敏。",
      labHold: "握拳保持时长(秒)",
      hintHold: "握拳保持多久才切换播放/暂停。",
      labFingers: "拖动需竖起的手指数",
      hintFingers: "3 = 最防误触;2 = 更好摆出;1 = 最宽松。",
      labPinch: "捏合灵敏度(越小 = 要捏得越紧)",
      hintPinch: "手指间距小于此值算捏合。",
      labRange: "拖动范围(整幅手扫过)",
      hintRange: "越小拖得越精细;「整条视频」= 一扫跨全片(旧行为)。",
      range30s: "30 秒",
      range1m: "1 分钟",
      range2m: "2 分钟",
      range5m: "5 分钟",
      rangeWhole: "整条视频",
      secDebug: "调试",
      labPreview: "显示摄像头预览 + 手骨架",
      hintPreview: "右下角显示识别到的手;调好后建议关掉。",
      secLanguage: "语言",
      langAuto: "跟随系统",
      reset: "恢复默认",
      // in-page toasts
      hint: "GesturePlay:即将请求摄像头权限,请点击「允许」(只问一次,画面仅本地处理、不上传)",
      cameraDenied: "GesturePlay:摄像头未授权。请点地址栏左侧的摄像头图标改为「允许」,然后刷新页面。",
      cameraLost: "GesturePlay:摄像头连接已断开,请重新连接后刷新页面。",
      modelFail: "GesturePlay:手势模型加载失败,请刷新页面重试。",
      detectFail: "GesturePlay:手势识别异常,请刷新页面重试。",
      initFail: "GesturePlay:初始化失败 — ",
    },
  };

  // Resolve a stored choice ("auto"|"zh"|"en") to a concrete language.
  function resolve(stored) {
    if (stored === "zh" || stored === "en") return stored;
    const n = (navigator.language || "en").toLowerCase();
    return n.indexOf("zh") === 0 ? "zh" : "en";
  }

  function t(lang, key) {
    const l = dict[lang] ? lang : "en";
    return (dict[l] && dict[l][key]) || dict.en[key] || key;
  }

  root.GSI18N = { dict: dict, resolve: resolve, t: t };
})(typeof globalThis !== "undefined" ? globalThis : this);
