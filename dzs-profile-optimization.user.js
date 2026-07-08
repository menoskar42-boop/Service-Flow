// ==UserScript==
// @name         DZS Profile Optimization (رفع السرعة) — Service-Flow
// @namespace    service-flow.dzs.po
// @description  يشغّل Profile Optimization (Start Realtime PO) على AXON Expresse لمجموعة أرقام أكونت — منفصل تماماً عن سكربت القياس. الوضع الكامل: [لو Nightly PO شغّال أوقفه] ثم Start Realtime PO. وضع «إيقاف PO» (sf_stop=1): يعمل سيكوينس الإيقاف فقط (Stop Nightly PO → Yes) ويرجّع Not Started؛ لو أصلاً Not Started مايعملش حاجة. يُفعَّل فقط عند وجود #sf_po أو علامة PO_ACTIVE.
// @version      0.9.1
// @match        *://10.42.187.101:8080/expresse/*
// @connect      service-flow-menoskar42.replit.app
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

  // رفع تلقائى لأوقات رفع السرعة / إيقاف PO فى Service-Flow (يظهر كعمودين فى تقارير القياس)
  const SF_API_BASE = "https://service-flow-menoskar42.replit.app"; // ← عدّليه لو الدومين اتغيّر
  const SF_PO_TOKEN = "sf-dzs-138-ingest-2026"; // لازم يطابق DZS_INGEST_TOKEN فى السيرفر
  const PO_RESULTS_KEY = "PO_RESULTS";       // [{ accountNo, event, time }]
  const PO_DOWNLOADED_KEY = "PO_DOWNLOADED";
  // يسجّل الحدث محلياً (للـ CSV) + يرفعه للموقع (للعمودين فى التقارير)
  function postPoEvent(accountNo, event) {
    try {
      const results = JSON.parse(localStorage.getItem(PO_RESULTS_KEY) || "[]");
      results.push({ accountNo: String(accountNo || ""), event, time: new Date().toISOString() });
      localStorage.setItem(PO_RESULTS_KEY, JSON.stringify(results));
    } catch (e) {}
    if (!SF_API_BASE || !accountNo) return;
    try {
      fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/po-events/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DZS-Token": SF_PO_TOKEN },
        body: JSON.stringify({ items: [{ accountNo: String(accountNo), event }] }),
      }).then(r => r.json()).then(j => console.log("☁️ PO event:", event, accountNo, j))
        .catch(e => console.warn("☁️ PO event failed:", e));
    } catch (e) { console.warn("po-event err", e); }
  }

  // تنزيل CSV بأحداث رفع السرعة / الإيقاف (مرة واحدة عند انتهاء الرن)
  function downloadPoCsv() {
    if (localStorage.getItem(PO_DOWNLOADED_KEY) === "1") return;
    const results = JSON.parse(localStorage.getItem(PO_RESULTS_KEY) || "[]");
    if (!results.length) return;
    localStorage.setItem(PO_DOWNLOADED_KEY, "1");
    const SEP = ";";
    const fmt = (iso) => { try { const d = new Date(iso); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()); } catch (e) { return iso || ""; } };
    const header = ["رقم الاكونت", "الحدث", "التاريخ والوقت"].join(SEP);
    const rows = results.map(r => [r.accountNo || "", r.event === "raise" ? "رفع سرعة" : "إيقاف PO", fmt(r.time)].join(SEP)).join("\n");
    const csv = "﻿" + header + "\n" + rows;
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "po_events_" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "_" + results.length + "rows.csv";
      (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      console.log("📥 PO CSV downloaded:", results.length, "events");
    } catch (e) { console.warn("csv err", e); }
  }

  const PO_ACCOUNTS_KEY = "PO_ACCOUNTS";
  const PO_INDEX_KEY = "PO_INDEX";
  const PO_MODE_KEY = "PO_MODE";   // "full" = رفع سرعة (Start Realtime PO) | "stop" = إيقاف الـ nightly فقط
  const PO_AFTER_KEY = "PO_AFTER"; // "1" = بعد رفع السرعة لكل الأرقام، نفّذ مرحلة الإيقاف لكلهم

  const POLL_MS = 800;
  const PER_ACCOUNT_TIMEOUT_MS = 10 * 60 * 1000; // مهلة قصوى لكل رقم (تكفّى انتظار اكتمال Real-time PO ~5 دقايق)
  const SETTLE_AFTER_YES_MS = 9000;              // ننتظر بعد Yes ليتسجّل الطلب قبل الرقم التالى
  const RE_RT = /currently\s*under\s*real-?time\s*po|under\s*real-?time\s*po/i; // «Currently under Real-time PO»

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
        const mount = () => {
          (document.body || document.documentElement).appendChild(v);
          const p = () => v.play().catch(() => {});
          p();
          document.addEventListener("visibilitychange", () => { if (!document.hidden) p(); });
        };
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
    localStorage.setItem(PO_AFTER_KEY, /[#&]sf_after=1\b/.test(hash) ? "1" : "0");
    localStorage.setItem(PO_RESULTS_KEY, "[]");
    localStorage.removeItem(PO_DOWNLOADED_KEY);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    console.log("⚡ PO: " + fromHash.length + " رقم (" + localStorage.getItem(PO_MODE_KEY) + ", after=" + localStorage.getItem(PO_AFTER_KEY) + ").");
  }
  const MODE = localStorage.getItem(PO_MODE_KEY) || "full";
  const AFTER = localStorage.getItem(PO_AFTER_KEY) === "1"; // رفع سرعة ثم إيقاف لكل الأرقام
  const ACCOUNTS = JSON.parse(localStorage.getItem(PO_ACCOUNTS_KEY) || "[]");
  function getIndex() { const i = parseInt(localStorage.getItem(PO_INDEX_KEY) || "0", 10); return isNaN(i) ? 0 : i; }
  function setIndex(i) { localStorage.setItem(PO_INDEX_KEY, String(i)); }

  if (!ACCOUNTS.length) { console.warn("⚠️ PO: لا توجد أرقام. افتحى الصفحة من زر «رفع سرعة» فى Service-Flow."); return; }

  const idx = getIndex();
  if (idx >= ACCOUNTS.length) {
    localStorage.removeItem(PO_ACTIVE_KEY);
    downloadPoCsv();
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

  // العنصر ظاهر فعلاً؟ (getClientRects أدقّ من offsetParent مع ديالوجات position:fixed)
  const isVisible = (el) => { try { return el.getClientRects().length > 0; } catch (e) { return false; } };

  // فى نافذة Confirm Action: (اختيارى) يحطّ شيك مارك per-tone ثم يضغط Yes.
  // ملاحظة: فى PrimeFaces الأزرار (Yes/No) بتكون فى buttonpane منفصل عن نص الرسالة،
  // فبندوّر على زر Yes فى كل الصفحة (العنصر الظاهر اللى نصّه "Yes" بالظبط) — مش جوّه div النص.
  function confirmDialogYes(wantCheckbox) {
    // الشيك مارك (للـ Start Realtime PO فقط) — الظاهر فقط
    if (wantCheckbox) {
      const nativeChks = [...document.querySelectorAll('input[type="checkbox"]')].filter(isVisible);
      if (nativeChks.length) {
        nativeChks.forEach(c => { if (!c.checked) c.click(); });
      } else {
        [...document.querySelectorAll(".ui-chkbox-box")].filter(isVisible)
          .forEach(b => { if (!b.querySelector(".ui-icon-check")) b.click(); });
      }
    }
    // زر Yes — نجرّب أنواع العناصر بالترتيب (button أولاً) وناخد أول عنصر ظاهر نصّه "Yes"
    const sels = ["button", "input[type='button']", "input[type='submit']", "a", "span", "div", "td"];
    for (const sel of sels) {
      const el = [...document.querySelectorAll(sel)].find(b => isVisible(b) && /^yes$/i.test((b.textContent || b.value || "").trim()));
      if (el) { el.click(); return true; }
    }
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
    if (idx + 1 >= ACCOUNTS.length) { localStorage.removeItem(PO_ACTIVE_KEY); downloadPoCsv(); banner("✅ خلص كل الأرقام. تقدر تقفل التاب.", "#2e7d32"); return; }
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

    // 2.5) «Line ID Not Found» بعد البحث → الرقم غير موجود، تخطّى فوراً للتالى (مننتظرش timeout)
    if (/line\s*id\s*not\s*found|enter\s*a\s*valid\s*line\s*id/i.test(txt())) {
      banner("⚠️ " + CURRENT + " غير موجود (Line ID Not Found) — تخطّى.", "#607d8b");
      clearInterval(tick); setTimeout(advance, 1200); return;
    }

    // 3) على صفحة الـ PO — استنى تحميلها
    const status = findValueByLabel("Status");
    const hasControl = /profile\s*optimization\s*control|choose\s*action/i.test(txt());
    if (!hasControl) return; // لسه بتحمّل

    // ---- init: قرّر حسب الحالة ----
    if (phase === "init") {
      if (RE_RT.test(status) || RE_RT.test(txt())) {
        // «Currently under Real-time PO» — فيه أوبتميزيشن شغّال دلوقتى
        if (MODE === "stop") {
          phase = "wait-rt-then-stop"; banner("⏳ فيه Real-time PO شغّال — استنى يخلّص عشان الإيقاف…", "#1565c0");
        } else {
          // رفع السرعة: متعملش حاجة — عدّى للخط اللى بعده
          banner("ℹ️ " + CURRENT + " تحت Real-time PO بالفعل — تخطّى.", "#ef6c00");
          clearInterval(tick); setTimeout(advance, 1500);
        }
      } else if (/not\s*started/i.test(status)) {
        // وضع الإيقاف فقط: مفيش nightly شغّال → مفيش حاجة نعملها، عدّى
        if (MODE === "stop") { banner("ℹ️ " + CURRENT + " أصلاً Not Started — مفيش nightly لإيقافه.", "#607d8b"); clearInterval(tick); setTimeout(advance, 1200); return; }
        // ابدأ Start Realtime PO
        if (selectAction(RE_START)) { phase = "confirm-start"; dialogShown = false; banner("▶️ Start Realtime PO…", "#1565c0"); }
      } else if (/nightly/i.test(status)) {
        // «In Nightly PO» → لازم نوقف الـ nightly PO الأول ثم نبدأ
        if (selectAction(RE_STOP)) { phase = "confirm-stop"; dialogShown = false; banner("⛔ إيقاف الـ Nightly PO أولاً…", "#ef6c00"); }
      } else if (status) {
        // حالة أخرى غير معروفة → تخطّى
        banner("ℹ️ الرقم " + CURRENT + " حالته: " + status + " — تخطّى.", "#ef6c00");
        clearInterval(tick); setTimeout(advance, 1500);
      }
      return;
    }

    // ---- wait-rt-then-stop: (وضع الإيقاف) استنى الـ Real-time PO يخلّص ثم أوقف الـ nightly ----
    if (phase === "wait-rt-then-stop") {
      const mins = Math.floor((Date.now() - startedAt) / 60000);
      banner("⏳ Real-time PO شغّال للرقم " + CURRENT + " (" + mins + " دق) — استنى يخلّص للإيقاف…", "#1565c0");
      if (/nightly/i.test(status)) { if (selectAction(RE_STOP)) { phase = "confirm-stop"; dialogShown = false; banner("⛔ خلّص — إيقاف الـ Nightly PO…", "#ef6c00"); } }
      else if (/not\s*started/i.test(status)) { banner("✅ خلّص بدون nightly — التالى.", "#2e7d32"); clearInterval(tick); setTimeout(advance, 1200); }
      return;
    }

    // ---- confirm-stop: تأكيد إيقاف الـ Nightly PO (Yes بدون شيك مارك) ----
    if (phase === "confirm-stop") {
      const dlg = /confirm\s*action|stop\s*nightly\s*po|are\s*you\s*sure/i.test(txt());
      if (dlg) { dialogShown = true; if (confirmDialogYes(false)) { postPoEvent(CURRENT, "stop"); phase = "await-not-started"; banner("⏳ جارٍ الإيقاف — استنى ترجع Not Started…", "#ef6c00"); } }
      else if (!dialogShown) selectAction(RE_STOP);
      return;
    }

    // ---- await-not-started: بعد الإيقاف نستنى الحالة ترجع Not Started ----
    if (phase === "await-not-started") {
      if (/not\s*started/i.test(status)) {
        // وضع الإيقاف فقط: خلصنا لهذا الرقم (مانبدأش Realtime PO) → التالى
        if (MODE === "stop") { banner("✅ اتوقف الـ PO للرقم " + CURRENT + " — التالى.", "#2e7d32"); clearInterval(tick); setTimeout(advance, 1200); return; }
        // وضع كامل: نعيد تحميل الصفحة نظيفة (بعد الإيقاف الدروب ليست بتفضل فى حالة مش نظيفة)
        // ثم نبدأ Start Realtime PO من صفحة جديدة حالتها Not Started.
        banner("↻ اتوقف الـ Nightly — إعادة تحميل للبدء برفع السرعة…", "#1565c0");
        clearInterval(tick);
        setTimeout(() => { location.href = PO_URL + encodeURIComponent(CURRENT); }, 1500);
      }
      return;
    }

    // ---- confirm-start: نافذة تأكيد Start Realtime PO → شيك مارك (per-tone) + Yes ----
    if (phase === "confirm-start") {
      const dlg = /confirm\s*action|options\s*for\s*the\s*realtime\s*po|per\s*tone\s*data/i.test(txt());
      if (dlg) {
        dialogShown = true;
        if (confirmDialogYes(true)) {
          postPoEvent(CURRENT, "raise");
          const isLast = (idx >= ACCOUNTS.length - 1);
          if (AFTER && isLast) {
            // وضع «رفع سرعة + إيقاف»، وده آخر خط: نستنى الأوبتميزيشن يخلّص (In Nightly PO)
            // ثم نبدأ مرحلة الإيقاف لكل الأرقام من الأول.
            phase = "wait-last-nightly"; banner("⏳ آخر خط — استنى يخلّص ثم نبدأ الإيقاف لكل الأرقام…", "#1565c0");
          } else {
            phase = "started"; banner("✅ اتبعت طلب رفع السرعة — التالى…", "#2e7d32"); setTimeout(() => { clearInterval(tick); advance(); }, SETTLE_AFTER_YES_MS);
          }
        }
      } else if (!dialogShown) selectAction(RE_START);
      return;
    }

    // ---- wait-last-nightly: (رفع سرعة + إيقاف) بعد رفع سرعة آخر خط نستنى يتحوّل لـ In Nightly PO
    //      ثم نبدأ مرحلة الإيقاف لكل الأرقام من أول رقم ----
    if (phase === "wait-last-nightly") {
      const mins = Math.floor((Date.now() - startedAt) / 60000);
      banner("⏳ آخر خط تحت Real-time PO (" + mins + " دق) — استنى In Nightly PO لبدء الإيقاف…", "#1565c0");
      if (/nightly/i.test(status)) {
        localStorage.setItem(PO_MODE_KEY, "stop");
        localStorage.setItem(PO_AFTER_KEY, "0");
        setIndex(0);
        clearInterval(tick);
        banner("↻ رفع السرعة اكتمل — بدء مرحلة الإيقاف لكل الأرقام…", "#ef6c00");
        setTimeout(() => { location.href = PO_URL + encodeURIComponent(ACCOUNTS[0]); }, 1500);
      }
      return;
    }
  }, POLL_MS);

  // أدوات كونسول
  window.PO_reset = () => { ["PO_ACCOUNTS", "PO_INDEX", "PO_ACTIVE", "PO_MODE", "PO_AFTER", "PO_RESULTS", "PO_DOWNLOADED"].forEach(k => localStorage.removeItem(k)); location.reload(); };
  window.PO_state = () => console.log({ accounts: ACCOUNTS, index: getIndex(), current: CURRENT });
})();
