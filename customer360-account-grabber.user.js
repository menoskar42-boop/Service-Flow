// ==UserScript==
// @name         Customer360 Account Grabber (Service-Flow)
// @namespace    service-flow.customer360
// @description  يفتح Customer360، يستنى تسجيل الدخول، يدخل رقم التليفون الكامل من تقرير Service-Flow، يستنى حل البازل يدوياً، يقرأ رقم الأكونت، يحفظه فى الموقع + شيت CSV. سكربت مستقل تماماً عن سكربتات DZS/FCC القديمة.
// @version      1.2.0
// @match        https://customer360.te.eg/*
// @connect      service-flow-menoskar42.replit.app
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  // الموقع اللى بنحفظ فيه أرقام الأكونت (نفس دومين Service-Flow). عدّليه لو الدومين اتغيّر.
  const SF_API_BASE = "https://service-flow-menoskar42.replit.app";
  // لازم يطابق C360_INGEST_TOKEN فى السيرفر (server/routes.ts)
  const SF_INGEST_TOKEN = "sf-c360-account-ingest-2026";
  const SF_AUTO_UPLOAD = true; // false لو عايزة CSV فقط من غير رفع تلقائى

  // مهلة انتظار حل البازل + ظهور النتيجة لكل رقم (دقايق) — البازل بيتحل يدوياً فممكن ياخد وقت
  const PER_PHONE_TIMEOUT_MS = 8 * 60 * 1000;
  const POLL_MS = 1200; // معدل فحص الصفحة بعد الضغط على بحث

  /* ================== STORAGE KEYS ================== */
  const PHONES_KEY  = "C360_PHONES";       // قائمة أرقام التليفون الكاملة
  const INDEX_KEY   = "C360_INDEX";        // مؤشر الرقم الحالى
  const RESULTS_KEY = "C360_RESULTS";      // [{ fullPhone, accountNo, status }]
  const RUNNING_KEY = "C360_RUNNING";      // "1" يعنى الجولة شغّالة (auto-advance)

  /* ================== READ PHONES FROM HASH / STORAGE ================== */
  // الزر فى Service-Flow بيفتح:  https://customer360.te.eg/Authentication/Login#sf_phones=88..,88..
  function readPhonesFromHash() {
    const m = location.hash.match(/sf_phones=([^&]+)/);
    if (!m) return null;
    const arr = decodeURIComponent(m[1]).split(",").map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }

  const fromHash = readPhonesFromHash();
  if (fromHash) {
    // قائمة جديدة وصلت من الموقع → ابدأ من الأول
    localStorage.setItem(PHONES_KEY, JSON.stringify(fromHash));
    localStorage.setItem(INDEX_KEY, "0");
    localStorage.setItem(RESULTS_KEY, "[]");
    localStorage.setItem(RUNNING_KEY, "1");
    // نظّف الهاش من الـ URL عشان ميفضلش ظاهر
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    console.log("🔗 C360: " + fromHash.length + " رقم تليفون اتحمّلوا من Service-Flow.");
  }

  const PHONES = JSON.parse(localStorage.getItem(PHONES_KEY) || "[]");
  function getIndex()  { const i = parseInt(localStorage.getItem(INDEX_KEY) || "0", 10); return isNaN(i) ? 0 : i; }
  function setIndex(i) { localStorage.setItem(INDEX_KEY, String(i)); }
  function getResults() { return JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]"); }
  function setResults(r) { localStorage.setItem(RESULTS_KEY, JSON.stringify(r)); }
  function isRunning() { return localStorage.getItem(RUNNING_KEY) === "1"; }
  function setRunning(v) { localStorage.setItem(RUNNING_KEY, v ? "1" : "0"); }

  /* ================== LOGIN PAGE DETECTION ================== */
  // على صفحة اللوجين منعملش حاجة — نستنى المستخدم يسجّل دخول بنفسه.
  function onLoginPage() {
    return /\/Authentication\/Login/i.test(location.pathname) ||
           !!document.querySelector('input[type="password"]');
  }

  /* ================== DOM HELPERS (heuristics) ================== */
  // خانة البحث "Search by Service No."
  function findSearchInput() {
    const sels = [
      'input[placeholder*="Service No" i]',
      'input[placeholder*="Search" i]',
      'input[type="search"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null) return el;
    }
    // آخر حل: أول input نصّى ظاهر فى الهيدر
    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')]
      .filter(el => el.offsetParent !== null);
    return inputs[0] || null;
  }

  // قراءة رقم الأكونت من صفحة العميل: "Account No.: # 4968645"
  function grabAccountNo() {
    const els = [...document.querySelectorAll("*")].filter(el =>
      el.children.length <= 3 && /account\s*no/i.test(el.textContent || ""));
    for (const el of els) {
      // النص الكامل للعنصر أو أقرب صف
      const scope = el.closest("tr, li, div, section") || el;
      const txt = (scope.textContent || "").replace(/\s+/g, " ");
      // رقم بعد علامة # أو بعد ":" — 4 أرقام أو أكثر
      const m = txt.match(/account\s*no\.?\s*:?\s*#?\s*(\d{4,})/i);
      if (m) return m[1];
    }
    return null;
  }

  // اكتشاف "العميل غير موجود" — رسالة مثل: Subscriber information is not exist
  function notExistOnPage() {
    const t = (document.body.innerText || "").toLowerCase();
    return /subscriber information is not exist|not exist|غير موجود|مفيش بيانات/i.test(t);
  }

  // اكتشاف نجاح البحث (لقراءة الأكونت بثقة)
  function searchSucceeded() {
    const t = (document.body.innerText || "").toLowerCase();
    return /search\s*successfully|تم البحث/i.test(t) || !!grabAccountNo();
  }

  /* ================== POST TO SERVICE-FLOW ================== */
  function postToServiceFlow(fullPhone, accountNo) {
    if (!SF_AUTO_UPLOAD || !SF_API_BASE || !accountNo) return;
    try {
      fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/line-accounts/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-C360-Token": SF_INGEST_TOKEN },
        body: JSON.stringify({ items: [{ fullPhone, accountNo }] }),
      }).then(r => r.json()).then(j => console.log("☁️ حُفظ فى الموقع:", fullPhone, "→", accountNo, j))
        .catch(e => console.warn("☁️ فشل الحفظ فى الموقع:", e));
    } catch (e) { console.warn("post err", e); }
  }

  // "Subscriber information is not exist" → نعلّم الخط "بدون رقم أكونت" فى الموقع
  // (نفس منطق الدايرة الحمراء جنب خانة الأكونت — الخط يختفى من تقرير «خطوط بدون رقم أكونت»)
  function markNoAccountOnSite(fullPhone) {
    if (!SF_AUTO_UPLOAD || !SF_API_BASE || !fullPhone) return;
    try {
      fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/line-accounts/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-C360-Token": SF_INGEST_TOKEN },
        body: JSON.stringify({ items: [{ fullPhone, notExist: true }] }),
      }).then(r => r.json()).then(j => console.log("🚫 اتعلّم بدون أكونت فى الموقع:", fullPhone, j))
        .catch(e => console.warn("🚫 فشل تعليم بدون أكونت:", e));
    } catch (e) { console.warn("mark err", e); }
  }

  /* ================== RESULTS / CSV ================== */
  function recordResult(fullPhone, accountNo, status) {
    const results = getResults();
    const existing = results.find(r => r.fullPhone === fullPhone);
    if (existing) { existing.accountNo = accountNo; existing.status = status; }
    else results.push({ fullPhone, accountNo, status });
    setResults(results);
    if (accountNo) postToServiceFlow(fullPhone, accountNo);
    else if (status === "غير موجود") markNoAccountOnSite(fullPhone);
    updatePanel();
  }

  function downloadCSV() {
    const results = getResults();
    if (!results.length) { alert("لا توجد نتائج بعد."); return; }
    const SEP = ";";
    const header = ["رقم التليفون الكامل", "رقم الاكونت", "الحالة"].join(SEP);
    const rows = results.map(r => [r.fullPhone || "", r.accountNo || "", r.status || ""].join(SEP)).join("\n");
    const csv = "﻿" + header + "\n" + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customer360_accounts_" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "_" + results.length + "rows.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ================== SEARCH ONE PHONE ================== */
  let busy = false;

  function pressEnter(el) {
    ["keydown", "keypress", "keyup"].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true,
      }));
    });
    // محاولة إضافية: لو الخانة جوة form
    const form = el.closest("form");
    if (form) { try { form.requestSubmit ? form.requestSubmit() : form.submit(); } catch (e) {} }
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function searchCurrentPhone() {
    if (busy) return;
    const idx = getIndex();
    if (idx >= PHONES.length) { finishAll(); return; }
    const phone = PHONES[idx];

    const input = findSearchInput();
    if (!input) { console.warn("⚠️ مش لاقى خانة البحث — هل سجّلتِ الدخول؟"); return; }

    busy = true;
    updatePanel("⌨️ بحث عن: " + phone + " — حُلّى البازل لو ظهر");

    input.focus();
    setNativeValue(input, phone);
    setTimeout(() => pressEnter(input), 250);

    // استنى النتيجة (بعد حل البازل يدوياً)
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (!isRunning()) { clearInterval(timer); busy = false; return; }

      // العميل ظهر؟
      const acct = grabAccountNo();
      if (acct) {
        clearInterval(timer);
        recordResult(phone, acct, "تم");
        console.log("✅ " + phone + " → أكونت " + acct);
        advance();
        return;
      }
      // غير موجود؟
      if (notExistOnPage()) {
        clearInterval(timer);
        recordResult(phone, "", "غير موجود");
        console.log("⚠️ " + phone + " → غير موجود");
        advance();
        return;
      }
      // مهلة
      if (Date.now() - t0 >= PER_PHONE_TIMEOUT_MS) {
        clearInterval(timer);
        busy = false;
        updatePanel("⏱️ انتهت مهلة الرقم " + phone + " — اضغطى ⏭️ تخطّى أو 🔁 إعادة");
      }
    }, POLL_MS);
  }

  function advance() {
    const idx = getIndex() + 1;
    setIndex(idx);
    busy = false;
    if (idx >= PHONES.length) { finishAll(); return; }
    // فاصل بسيط قبل الرقم التالى
    setTimeout(() => { if (isRunning()) searchCurrentPhone(); }, 1500);
  }

  function finishAll() {
    setRunning(false);
    busy = false;
    updatePanel("🏁 خلصنا كل الأرقام (" + getResults().length + "). نزّلى CSV.");
    downloadCSV();
  }

  /* ================== CONTROL PANEL ================== */
  let panelEl, statusEl;
  function buildPanel() {
    if (document.getElementById("c360-panel")) return;
    panelEl = document.createElement("div");
    panelEl.id = "c360-panel";
    panelEl.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#4a148c;color:#fff;" +
      "font:13px/1.5 Arial;padding:12px 14px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.35);width:300px;direction:rtl";
    panelEl.innerHTML =
      '<div style="font-weight:bold;font-size:14px;margin-bottom:6px">📇 Customer360 — جلب الأكونت</div>' +
      '<div id="c360-status" style="margin-bottom:8px;min-height:34px"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button id="c360-start" style="flex:1;background:#00c853;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer">▶️ ابدأ</button>' +
        '<button id="c360-pause" style="flex:1;background:#ff9100;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer">⏸️ وقف</button>' +
        '<button id="c360-skip" style="flex:1;background:#607d8b;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer">⏭️ تخطّى</button>' +
        '<button id="c360-retry" style="flex:1;background:#3949ab;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer">🔁 إعادة</button>' +
        '<button id="c360-csv" style="flex:1 1 100%;background:#1976d2;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer;margin-top:4px">📥 تنزيل CSV</button>' +
      '</div>';
    document.body.appendChild(panelEl);
    statusEl = document.getElementById("c360-status");

    document.getElementById("c360-start").onclick = () => { setRunning(true); busy = false; searchCurrentPhone(); };
    document.getElementById("c360-pause").onclick = () => { setRunning(false); updatePanel("⏸️ متوقف."); };
    document.getElementById("c360-skip").onclick  = () => { recordResult(PHONES[getIndex()] || "", "", "تخطّى"); advance(); };
    document.getElementById("c360-retry").onclick = () => { busy = false; searchCurrentPhone(); };
    document.getElementById("c360-csv").onclick   = () => downloadCSV();
    updatePanel();
  }

  function updatePanel(msg) {
    if (!statusEl) return;
    const idx = getIndex(), total = PHONES.length, done = getResults().length;
    let line = "التقدّم: " + Math.min(idx, total) + " / " + total + " — اتسجّل: " + done;
    if (idx < total) line += '<br><span style="color:#ffd">الحالى: ' + (PHONES[idx] || "-") + "</span>";
    if (msg) line += '<br><span style="color:#b2ff59">' + msg + "</span>";
    statusEl.innerHTML = line;
  }

  /* ================== BOOT ================== */
  function boot() {
    if (!document.body) { setTimeout(boot, 300); return; }
    buildPanel();

    if (onLoginPage()) {
      updatePanel("🔐 سجّلى الدخول الأول… السكربت هيشتغل أوتوماتيك بعد الدخول.");
      // استنى لحد ما يخرج من صفحة اللوجين
      const w = setInterval(() => {
        if (!onLoginPage()) { clearInterval(w); setTimeout(afterLogin, 1500); }
      }, 1000);
      return;
    }
    afterLogin();
  }

  function afterLogin() {
    buildPanel();
    if (!PHONES.length) {
      updatePanel("لا توجد أرقام — افتحى الصفحة من زر «جلب الأكونت من Customer360» فى Service-Flow.");
      return;
    }
    if (getIndex() >= PHONES.length) {
      updatePanel("🏁 خلصت القائمة. نزّلى CSV أو افتحى قائمة جديدة من الموقع.");
      return;
    }
    if (isRunning()) {
      updatePanel("جاهز — اضغطى ▶️ ابدأ لو ماشتغلش لوحده.");
      setTimeout(() => { if (isRunning() && !busy) searchCurrentPhone(); }, 1200);
    } else {
      updatePanel("متوقف — اضغطى ▶️ ابدأ.");
    }
  }

  boot();

  // أدوات للكونسول
  window.C360_results = () => console.table(getResults());
  window.C360_reset   = () => { [PHONES_KEY, INDEX_KEY, RESULTS_KEY, RUNNING_KEY].forEach(k => localStorage.removeItem(k)); location.reload(); };
})();
