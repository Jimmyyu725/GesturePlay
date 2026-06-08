// popup.js — GestureSeek settings. Persists to chrome.storage.local; content.js
// reads these and applies them live.
const DEFAULTS = { gsDeadzone: 0.05, gsHold: 0.35, gsFingers: 3, gsPinch: 0.05, gsPreview: false };

function $(id) {
  return document.getElementById(id);
}
function fix(v, dec) {
  return Number(v).toFixed(dec);
}

function render(s) {
  $("deadzone").value = s.gsDeadzone;
  $("vDead").textContent = fix(s.gsDeadzone, 2);
  $("hold").value = s.gsHold;
  $("vHold").textContent = fix(s.gsHold, 2);
  $("fingers").value = s.gsFingers;
  $("vFingers").textContent = String(s.gsFingers);
  $("pinch").value = s.gsPinch;
  $("vPinch").textContent = fix(s.gsPinch, 3);
  $("preview").checked = !!s.gsPreview;
}

document.addEventListener("DOMContentLoaded", function () {
  chrome.storage.local.get(DEFAULTS, function (s) {
    render(Object.assign({}, DEFAULTS, s));
  });

  $("deadzone").addEventListener("input", function (e) {
    const v = parseFloat(e.target.value);
    $("vDead").textContent = fix(v, 2);
    chrome.storage.local.set({ gsDeadzone: v });
  });
  $("hold").addEventListener("input", function (e) {
    const v = parseFloat(e.target.value);
    $("vHold").textContent = fix(v, 2);
    chrome.storage.local.set({ gsHold: v });
  });
  $("fingers").addEventListener("input", function (e) {
    const v = parseInt(e.target.value, 10);
    $("vFingers").textContent = String(v);
    chrome.storage.local.set({ gsFingers: v });
  });
  $("pinch").addEventListener("input", function (e) {
    const v = parseFloat(e.target.value);
    $("vPinch").textContent = fix(v, 3);
    chrome.storage.local.set({ gsPinch: v });
  });
  $("preview").addEventListener("change", function (e) {
    chrome.storage.local.set({ gsPreview: e.target.checked });
  });

  $("reset").addEventListener("click", function () {
    chrome.storage.local.set(DEFAULTS, function () {
      render(DEFAULTS);
    });
  });
});
