// popup.js — GesturePlay settings + language. Persists to chrome.storage.sync
// so settings roam with the browser profile; content.js applies them live.
const DEFAULTS = {
  gsEnabled: true,
  gsDeadzone: 0.05,
  gsHold: 0.35,
  gsFingers: 3,
  gsPinch: 0.05,
  gsRange: 60,
  gsPreview: false,
  gsLang: "auto",
};
const I = globalThis.GSI18N;

function $(id) {
  return document.getElementById(id);
}
function fix(v, dec) {
  return Number(v).toFixed(dec);
}

// storage.sync enforces write-rate quotas (~120/min); slider "input" events fire
// continuously while dragging, so debounce the writes per key.
const saveTimers = {};
function save(key, value, delayMs) {
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(function () {
    const o = {};
    o[key] = value;
    chrome.storage.sync.set(o);
  }, delayMs == null ? 200 : delayMs);
}

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

// Fill every [data-i18n] element with the string for the resolved language.
function applyI18n(lang) {
  const els = document.querySelectorAll("[data-i18n]");
  for (let k = 0; k < els.length; k++) {
    els[k].textContent = I.t(lang, els[k].getAttribute("data-i18n"));
  }
}

function render(s) {
  $("enabled").checked = s.gsEnabled !== false;
  $("deadzone").value = s.gsDeadzone;
  $("vDead").textContent = fix(s.gsDeadzone, 2);
  $("hold").value = s.gsHold;
  $("vHold").textContent = fix(s.gsHold, 2);
  $("fingers").value = s.gsFingers;
  $("vFingers").textContent = String(s.gsFingers);
  $("pinch").value = s.gsPinch;
  $("vPinch").textContent = fix(s.gsPinch, 3);
  $("range").value = String(s.gsRange);
  $("preview").checked = !!s.gsPreview;
  $("lang").value = s.gsLang;
  applyI18n(I.resolve(s.gsLang));
}

document.addEventListener("DOMContentLoaded", function () {
  migrateLocalToSync(function () {
    chrome.storage.sync.get(DEFAULTS, function (s) {
      render(Object.assign({}, DEFAULTS, s));
    });
  });

  $("enabled").addEventListener("change", function (e) {
    save("gsEnabled", e.target.checked, 0);
  });
  $("lang").addEventListener("change", function (e) {
    const v = e.target.value;
    save("gsLang", v, 0);
    applyI18n(I.resolve(v));
  });
  $("deadzone").addEventListener("input", function (e) {
    const v = parseFloat(e.target.value);
    $("vDead").textContent = fix(v, 2);
    save("gsDeadzone", v);
  });
  $("hold").addEventListener("input", function (e) {
    const v = parseFloat(e.target.value);
    $("vHold").textContent = fix(v, 2);
    save("gsHold", v);
  });
  $("fingers").addEventListener("input", function (e) {
    const v = parseInt(e.target.value, 10);
    $("vFingers").textContent = String(v);
    save("gsFingers", v);
  });
  $("pinch").addEventListener("input", function (e) {
    const v = parseFloat(e.target.value);
    $("vPinch").textContent = fix(v, 3);
    save("gsPinch", v);
  });
  $("range").addEventListener("change", function (e) {
    save("gsRange", parseInt(e.target.value, 10), 0);
  });
  $("preview").addEventListener("change", function (e) {
    save("gsPreview", e.target.checked, 0);
  });

  $("reset").addEventListener("click", function () {
    chrome.storage.sync.set(DEFAULTS, function () {
      render(DEFAULTS);
    });
  });
});
