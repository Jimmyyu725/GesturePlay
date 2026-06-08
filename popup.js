// popup.js — GestureSeek settings + language. Persists to chrome.storage.local;
// content.js reads these and applies them live.
const DEFAULTS = { gsDeadzone: 0.05, gsHold: 0.35, gsFingers: 3, gsPinch: 0.05, gsPreview: false, gsLang: "auto" };
const I = globalThis.GSI18N;

function $(id) {
  return document.getElementById(id);
}
function fix(v, dec) {
  return Number(v).toFixed(dec);
}

// Fill every [data-i18n] element with the string for the resolved language.
function applyI18n(lang) {
  const els = document.querySelectorAll("[data-i18n]");
  for (let k = 0; k < els.length; k++) {
    els[k].textContent = I.t(lang, els[k].getAttribute("data-i18n"));
  }
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
  $("lang").value = s.gsLang;
  applyI18n(I.resolve(s.gsLang));
}

document.addEventListener("DOMContentLoaded", function () {
  chrome.storage.local.get(DEFAULTS, function (s) {
    render(Object.assign({}, DEFAULTS, s));
  });

  $("lang").addEventListener("change", function (e) {
    const v = e.target.value;
    chrome.storage.local.set({ gsLang: v });
    applyI18n(I.resolve(v));
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
