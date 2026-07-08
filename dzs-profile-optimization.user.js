// ==UserScript==
// @name         DZS Profile Optimization (رفع السرعة) — Service-Flow
// @namespace    service-flow.dzs.po
// @description  يشغّل Profile Optimization (Start Realtime PO) على AXON Expresse لمجموعة أرقام أكونت — منفصل تماماً عن سكربت القياس. الوضع الكامل: [لو Nightly PO شغّال أوقفه] ثم Start Realtime PO. وضع «إيقاف PO» (sf_stop=1): يعمل سيكوينس الإيقاف فقط (Stop Nightly PO → Yes) ويرجّع Not Started؛ لو أصلاً Not Started مايعملش حاجة. يُفعَّل فقط عند وجود #sf_po أو علامة PO_ACTIVE.
// @version      0.5.0
// @match        *://10.42.187.101:8080/expresse/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== تفعيل السكربت ==================
     يشتغل فقط لو فيه run رفع سرعة: هاش #sf_po=acc1,acc2  أو علامة PO_ACTIVE فى localStorage.
     لو run قياس شغّال (#sf_accounts) نقف فوراً — ملناش دعوة. */
  const hash = location.hash || "";
  const hasPoHash = /[#&]sf_po=/.test(hash);
  if (/[#&]sf_accounts=/.test(hash)) return; // وضع القياس — مش شغلنا
  const PO_ACTIVE_KEY = "PO_ACTIVE";
  if (!hasPoHash && localStorage.getItem(PO_ACTIVE_KEY) !== "1") return;

  /* ================== CONFIG ================== */
  const USER = "xceed_lob";
  const PASS = "xceed.lob@1234";
  const BASE = location.origin + "/expresse";
  const PO_URL = BASE + "/profileOptimization?lineId=";

  const PO_ACCOUNTS_KEY = "PO_ACCOUNTS";
  const PO_INDEX_KEY = "PO_INDEX";
  const PO_MODE_KEY = "PO_MODE"; // "full" = إيقاف nightly (لو موجود) ثم Start Realtime PO | "stop" = إيقاف الـ nightly فقط

  const POLL_MS = 800;
  const PER_ACCOUNT_TIMEOUT_MS = 3 * 60 * 1000; // مهلة قصوى لكل رقم قبل ما نعدّى
  const SETTLE_AFTER_YES_MS = 9000;             // ننتظر بعد Yes ليتسجّل الطلب قبل الرقم التالى

  /* ================== منع نوم الشاشة (زى سكربت القياس) ================== */
  (function keepScreenAwake() {
    let wl = null;
    const acquireWL = async () => {
      try { if (navigator.wakeLock && !wl) { wl = await navigator.wakeLock.request("screen"); wl.addEventListener("release", () => { wl = null; }); } } catch (e) {}
    };
    acquireWL();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) acquireWL(); });
    try {
      const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
      const ctx = canvas.getContext("2d"); let f = 0;
      setInterval(() => { f = (f + 3) % 255; if (ctx) { ctx.fillStyle = "rgb(" + f + ",0,0)"; ctx.fillRect(0, 0, 2, 2); } }, 1000);
      const stream = canvas.captureStream ? canvas.captureStream(2) : null;
      if (stream) {
        const v = document.createElement("video");
        v.srcObject = stream; v.muted = true; v.setAttribute("playsinline", ""); v.setAttribute("autoplay", ""); v.loop = true;
        v.style.cssText = "position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;";
        const mount = () => { (document.body || document.documentElement).appendChild(v); v.play().catch(() => {}); };
        document.body ? mount() : window.addEventListener("DOMContentLoaded", mount);
      }
    } catch (e) {}
  })();

  /* ================== قائمة الأرقام ================== */
  function readPoAccountsFromHash() {
    const m = hash.match(/sf_po=([^&]+)/);
    if (!m) return null;
    const arr = decodeURIComponent(m[1]).split(",").map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  const fromHash = readPoAccountsFromHash();
  if (fromHash) {
    localStorage.setItem(PO_ACCOUNTS_KEY, JSON.stringify(fromHash));
    localStorage.setItem(PO_INDEX_KEY, "0");
    localStorage.setItem(PO_ACTIVE_KEY, "1");
    localStorage.setItem(PO_MODE_KEY, /[#&]sf_stop=1\b/.test(hash) ? "stop" : "full");
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    console.log("⚡ PO: " + fromHash.length + " رقم أكونت (" + (localStorage.getItem(PO_MODE_KEY)) + ").");
  }
  const MODE = localStorage.getItem(PO_MODE_KEY) || "full";
  const ACCOUNTS = JSON.parse(localStorage.getItem(PO_ACCOUNTS_KEY) || "[]");
  function getIndex() { const i = parseInt(localStorage.getItem(PO_INDEX_KEY) || "0", 10); return isNaN(i) ? 0 : i; }
  function setIndex(i) { localStorage.setItem(PO_INDEX_KEY, String(i)); }

  if (!ACCOUNTS.length) { console.warn("⚠️ PO: لا توجد أرقام. افتحى الصفحة من زر «رفع سرعة» فى Service-Flow."); return; }

  const idx = getIndex();
  if (idx >= ACCOUNTS.length) {
    localStorage.removeItem(PO_ACTIVE_KEY);
    banner("✅ تم إرسال طلب رفع السرعة لكل الأرقام (" + ACCOUNTS.length + "). تقدر تقفل التاب.", "#2e7d32");
    return;
  }
  const CURRENT = ACCOUNTS[idx];

  /* ================== UI شريط الحالة ================== */
  let statusBar;
  function banner(msg, color) {
    try {
      if (!statusBar) {
        statusBar = document.createElement("div");
        statusBar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 14px;font:bold 14px Arial;color:#fff;text-align:center";
        (document.body || document.documentElement).appendChild(statusBar);
      }
      statusBar.style.background = color || "#1565c0";
      statusBar.textContent = msg;
    } catch (e) {}
  }
  banner("⚡ رفع السرعة: الرقم " + (idx + 1) + "/" + ACCOUNTS.length + " (" + CURRENT + ")", "#1565c0");

  /* ================== أدوات DOM ================== */
  const txt = () => (document.body && document.body.innerText || "");
  const onLoginPage = () => !!document.querySelector('#j_username, input[type="password"]');
  const onPoPage = () => /\/expresse\/profileOptimization/i.test(location.pathname);

  function findValueByLabel(label) {
    const cands = [...document.querySelectorAll("*")].filter(el => el.children.length === 0 && el.textContent.trim() === label);
    for (const el of cands) {
      const tr = el.closest("tr");
      if (tr) { const cells = [...tr.children]; const i = cells.findIndex(c => c === el || c.contains(el)); for (let k = i + 1; k < cells.length; k++) { const t = cells[k].textContent.trim(); if (t) return t; } }
      let cur = el;
      for (let d = 0; d < 5; d++) { const p = cur.parentElement; if (!p) break; const n = p.nextElementSibling; if (n) { const t = n.textContent.trim(); if (t && t !== label) return t; } cur = p; }
    }
    return "";
  }

  // يفتح دروب ليست "Choose Action" ويختار العنصر المطابق للـ regex (Start Realtime PO أو Stop Nightly PO)
  function selectAction(re) {
    // 1) native <select>
    for (const sel of document.querySelectorAll("select")) {
      const opt = [...sel.options].find(o => re.test(o.textContent || ""));
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; }
    }
    // 2) PrimeFaces/JSF styled dropdown: افتح البانل
    const openTriggers = [...document.querySelectorAll(".ui-selectonemenu-trigger, .ui-selectonemenu-label, [class*='selectonemenu']")];
    for (const tr of openTriggers) {
      const near = (tr.closest("*") || tr).textContent || "";
      if (/choose\s*action|start\s*realtime|stop\s*nightly|schedule\s*nightly/i.test(near) || tr.classList.contains("ui-selectonemenu-trigger")) { tr.click(); break; }
    }
    // بعد الفتح، دوّر على عنصر القائمة
    const items = [...document.querySelectorAll(".ui-selectonemenu-item, li[data-label], li[role='option'], .ui-selectonemenu-list li")];
    const target = items.find(li => re.test(li.textContent || ""));
    if (target) { target.click(); return true; }
    // 3) أى عنصر ظاهر نصّه مطابق
    const any = [...document.querySelectorAll("li,a,span,div,option")].find(el => el.offsetParent !== null && re.test((el.textContent || "").trim()) && (el.textContent || "").trim().length < 60);
    if (any) { any.click(); return true; }
    return false;
  }
  const RE_START = /start\s*realtime\s*po/i;
  const RE_STOP  = /stop\s*nightly\s*po/i;

  // فى نافذة Confirm Action: يحطّ الشيك مارك (per-tone) ويضغط Yes
  function confirmDialogYes() {
    // الديالوج الظاهر اللى فيه نص Confirm/Realtime PO
    const dialogs = [...document.querySelectorAll("div")].filter(d => d.offsetParent !== null && /confirm\s*action|options\s*for\s*the\s*realtime\s*po|per\s*tone\s*data/i.test(d.textContent || ""));
    const scope = dialogs.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0] || document;
    // الشيك مارك — native أو PrimeFaces
    let checked = false;
    const nativeChk = scope.querySelector('input[type="checkbox"]');
    if (nativeChk) { if (!nativeChk.checked) { nativeChk.click(); } checked = true; }
    if (!checked) {
      const pfBox = scope.querySelector(".ui-chkbox-box");
      if (pfBox && !pfBox.querySelector(".ui-icon-check")) { pfBox.click(); checked = true; }
      else if (pfBox) checked = true;
    }
    // زر Yes
    const yes = [...scope.querySelectorAll("button, a, span, input[type='button']")].find(b => b.offsetParent !== null && /^\s*yes\s*$/i.test((b.textContent || b.value || "").trim()));
    if (yes) { yes.click(); return true; }
    return false;
  }

  /* ================== ماكينة الحالة ==================
     الوضع الكامل (full): [لو nightly شغّال: أوقفه] → Start Realtime PO → التالى.
     وضع الإيقاف فقط (stop): [لو nightly شغّال: أوقفه فقط] → التالى. */
  let phase = "init"; // init → [confirm-stop → await-not-started → init] → confirm-start → started
  let dialogShown = false;
  const startedAt = Date.now();

  function advance() {
    setIndex(idx + 1);
    if (idx + 1 >= ACCOUNTS.length) { localStorage.removeItem(PO_ACTIVE_KEY); banner("✅ خلص كل الأرقام. تقدر تقفل التاب.", "#2e7d32"); return; }
    location.href = PO_URL + encodeURIComponent(ACCOUNTS[idx + 1]);
  }

  const tick = setInterval(() => {
    // مهلة أمان
    if (Date.now() - startedAt > PER_ACCOUNT_TIMEOUT_MS) { clearInterval(tick); console.warn("⏱️ PO timeout للرقم " + CURRENT + " — نعدّى للتالى."); advance(); return; }

    // 1) صفحة اللوجين
    if (onLoginPage()) {
      const u = document.querySelector("#j_username"), p = document.querySelector("#j_password"), b = document.querySelector("button.ui-button, button, input[type='submit']");
      if (u && p && b) { u.value = USER; p.value = PASS; b.click(); banner("🔐 تسجيل الدخول…", "#6a1b9a"); }
      return;
    }

    // 2) مش على صفحة الـ PO للرقم الصح → روح لها
    if (!onPoPage()) { banner("↪️ فتح صفحة رفع السرعة للرقم " + CURRENT + "…", "#1565c0"); location.href = PO_URL + encodeURIComponent(CURRENT); clearInterval(tick); return; }

    // 3) على صفحة الـ PO — استنى تحميلها
    const status = findValueByLabel("Status");
    const hasControl = /profile\s*optimization\s*control|choose\s*action/i.test(txt());
    if (!hasControl) return; // لسه بتحمّل

    // ---- init: قرّر حسب الحالة ----
    if (phase === "init") {
      if (/not\s*started/i.test(status)) {
        // وضع الإيقاف فقط: مفيش nightly شغّال → مفيش حاجة نعملها، عدّى
        if (MODE === "stop") { banner("ℹ️ " + CURRENT + " أصلاً Not Started — مفيش nightly لإيقافه.", "#607d8b"); clearInterval(tick); setTimeout(advance, 1200); return; }
        // ابدأ Start Realtime PO
        if (selectAction(RE_START)) { phase = "confirm-start"; dialogShown = false; banner("▶️ Start Realtime PO…", "#1565c0"); }
      } else if (/nightly/i.test(status)) {
        // «In Nightly PO» → لازم نوقف الـ nightly PO الأول ثم نبدأ
        if (selectAction(RE_STOP)) { phase = "confirm-stop"; dialogShown = false; banner("⛔ إيقاف الـ Nightly PO أولاً…", "#ef6c00"); }
      } else if (status) {
        // شغّالة فعلاً (Currently under Real-time PO) أو حالة أخرى → تخطّى
        banner("ℹ️ الرقم " + CURRENT + " حالته: " + status + " — تخطّى.", "#ef6c00");
        clearInterval(tick); setTimeout(advance, 1500);
      }
      return;
    }

    // ---- confirm-stop: تأكيد إيقاف الـ Nightly PO (Yes بدون شيك مارك) ----
    if (phase === "confirm-stop") {
      const dlg = /confirm\s*action|stop\s*nightly\s*po|are\s*you\s*sure/i.test(txt());
      if (dlg) { dialogShown = true; if (confirmDialogYes()) { phase = "await-not-started"; banner("⏳ جارٍ الإيقاف — استنى ترجع Not Started…", "#ef6c00"); } }
      else if (!dialogShown) selectAction(RE_STOP);
      return;
    }

    // ---- await-not-started: بعد الإيقاف نستنى الحالة ترجع Not Started ----
    if (phase === "await-not-started") {
      if (/not\s*started/i.test(status)) {
        // وضع الإيقاف فقط: خلصنا لهذا الرقم (مانبدأش Realtime PO) → التالى
        if (MODE === "stop") { banner("✅ اتوقف الـ PO للرقم " + CURRENT + " — التالى.", "#2e7d32"); clearInterval(tick); setTimeout(advance, 1200); return; }
        phase = "init"; // وضع كامل: نبدأ Start Realtime PO
      }
      return;
    }

    // ---- confirm-start: نافذة تأكيد Start Realtime PO → شيك مارك (per-tone) + Yes ----
    if (phase === "confirm-start") {
      const dlg = /confirm\s*action|options\s*for\s*the\s*realtime\s*po|per\s*tone\s*data/i.test(txt());
      if (dlg) {
        dialogShown = true;
        if (confirmDialogYes()) { phase = "started"; banner("✅ اتبعت طلب رفع السرعة — التالى…", "#2e7d32"); setTimeout(() => { clearInterval(tick); advance(); }, SETTLE_AFTER_YES_MS); }
      } else if (!dialogShown) selectAction(RE_START);
      return;
    }
  }, POLL_MS);

  // أدوات كونسول
  window.PO_reset = () => { ["PO_ACCOUNTS", "PO_INDEX", "PO_ACTIVE", "PO_MODE"].forEach(k => localStorage.removeItem(k)); location.reload(); };
  window.PO_state = () => console.log({ accounts: ACCOUNTS, index: getIndex(), current: CURRENT });
})();
