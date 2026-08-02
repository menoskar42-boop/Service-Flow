// ==UserScript==
// @name         WFM Reporting — Voice Installation Raw Data → Service-Flow
// @namespace    service-flow.wfm.voice-raw
// @description  يفتح wfm.te.eg/WfmReports، يسجّل الدخول، Reports → FO Raw Data Reports → «+» → Voice Installation Raw Data Report → Add Report، يحطّ التواريخ (آخر 30 يوم) + Middle Upper / Asuit Region، يضغط Generate ثم Export، ويرفع الشيت تلقائياً على تقرير أوامر الشغل فى Service-Flow.
// @version      1.0.0
// @match        https://wfm.te.eg/WfmReports/*
// @grant        GM_xmlhttpRequest
// @connect      service-flow-menoskar42.replit.app
// @connect      replit.app
// @connect      wfm.te.eg
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mina109756";
  const PASS = "Mon_oskar11";
  const SF_URL   = "https://service-flow-menoskar42.replit.app";
  const SF_TOKEN = "sf-auto-upload-2026";
  const DAYS_BACK = 29;                       // من (النهاردة − 29) إلى النهاردة = 30 يوم
  const REPORT_NAME   = "Voice Installation Raw Data Report";
  const CATEGORY_NAME = "FO Raw Data Reports";
  const SECTOR = "Middle Upper";
  const REGION = "Asuit Region";
  const AUTO_CLOSE_MS = 20000;                // يقفل التاب بعد الرفع (0 = مايقفلش)

  /* ================== أدوات عامة ================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { try { return !!el && el.getClientRects().length > 0; } catch (e) { return false; } };
  const txt = (el) => ((el && el.textContent) || "").replace(/\s+/g, " ").trim();

  async function waitFor(fn, ms, step) {
    const end = Date.now() + (ms || 30000);
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) {}
      await sleep(step || 300);
    }
    return null;
  }

  // كل الـ documents (الصفحة + أى iframes من نفس الأصل)
  function docs() {
    const out = [document];
    const walk = (root) => {
      let ifr = [];
      try { ifr = [...root.querySelectorAll("iframe,frame")]; } catch (e) {}
      for (const f of ifr) {
        let d = null; try { d = f.contentDocument; } catch (e) {}
        if (d && out.indexOf(d) === -1) { out.push(d); walk(d); }
      }
    };
    walk(document);
    return out;
  }
  function qAll(sel) {
    const r = [];
    for (const d of docs()) { try { r.push(...d.querySelectorAll(sel)); } catch (e) {} }
    return r;
  }
  // عنصر ظاهر نصّه بيطابق re
  function findByText(sel, re, maxLen) {
    return qAll(sel).find((e) => visible(e) && re.test(txt(e)) && (!maxLen || txt(e).length <= maxLen)) || null;
  }

  function fireClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    const o = { bubbles: true, cancelable: true, view: window };
    for (const t of ["pointerover", "mouseover", "pointerdown", "mousedown", "focus", "pointerup", "mouseup", "click"]) {
      try {
        const E = t.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent
                : (t === "focus" ? FocusEvent : MouseEvent);
        el.dispatchEvent(new E(t, o));
      } catch (e) { try { el.dispatchEvent(new MouseEvent(t.replace("pointer", "mouse"), o)); } catch (e2) {} }
    }
    try { if (typeof el.click === "function") el.click(); } catch (e) {}
    return true;
  }

  // كتابة قيمة فى input بطريقة تُشعِر Angular/React بالتغيير
  function setValue(input, value) {
    if (!input) return false;
    try { input.focus(); } catch (e) {}
    try {
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, "value");
      if (d && d.set) d.set.call(input, value); else input.value = value;
    } catch (e) { input.value = value; }
    for (const t of ["input", "change", "keyup", "blur"]) {
      try { input.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {}
    }
    return true;
  }

  /* ================== التواريخ ================== */
  const pad = (n) => String(n).padStart(2, "0");
  function dateRange() {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - DAYS_BACK);
    return { from, to };
  }
  // الواجهة بتستخدم input[type=date] غالباً (yyyy-mm-dd)، وإلا نص m/d/yyyy
  const isoOf  = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const usOf   = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

  function setDateInput(input, d) {
    if (!input) return false;
    const type = (input.getAttribute("type") || "").toLowerCase();
    return setValue(input, type === "date" ? isoOf(d) : usOf(d));
  }

  /* ================== بانر الحالة ================== */
  let bar;
  function banner(msg, color) {
    if (!document.body) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 12px;" +
        "font:bold 13px Arial;color:#fff;background:#8e1e1e;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.4)";
      document.body.appendChild(bar);
    }
    bar.style.background = color || "#8e1e1e";
    bar.textContent = msg;
    console.log("[WFM-VOICE]", msg);
  }

  /* ================== تسجيل الدخول ================== */
  async function login() {
    const pass = await waitFor(() => {
      const p = qAll("input[type='password']").find(visible);
      return p || null;
    }, 30000);
    if (!pass) return false;
    // خانة اليوزر = أول input نصّى ظاهر قبل خانة الباسورد
    const all = qAll("input").filter(visible);
    const user = all.slice(0, all.indexOf(pass)).reverse()
      .find((i) => !/password/i.test(i.type || "")) || all[0];
    banner("🔐 تسجيل الدخول…");
    if (user) setValue(user, USER);
    setValue(pass, PASS);
    await sleep(400);
    const btn = findByText("button, input[type='submit'], a", /^\s*login\s*$/i, 20)
             || qAll("button, input[type='submit']").find(visible);
    if (btn) fireClick(btn);
    else { try { pass.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); } catch (e) {} }
    return true;
  }

  /* ================== دروب ليست (ng-select / PrimeNG / select) ================== */
  // بيفتح الدروب المرتبط بالـ label ويختار العنصر اللى نصّه يطابق valueRe
  async function pickFromDropdown(boxEl, valueRe) {
    if (!boxEl) return false;
    fireClick(boxEl);
    await sleep(700);
    const item = await waitFor(() => {
      const cands = qAll("li, .ng-option, .p-dropdown-item, [role='option'], option, .mat-option")
        .filter((el) => visible(el) && valueRe.test(txt(el)));
      cands.sort((a, b) => txt(a).length - txt(b).length);   // الأقرب للنص المطلوب
      return cands[0] || null;
    }, 8000);
    if (!item) return false;
    fireClick(item);
    await sleep(500);
    return true;
  }

  // يلاقى الحاوية القابلة للضغط الخاصة بحقل عنوانه labelRe
  function fieldBoxByLabel(labelRe) {
    for (const d of docs()) {
      let labels = [];
      try {
        labels = [...d.querySelectorAll("label, span, div, th")]
          .filter((e) => e.children.length === 0 && labelRe.test(txt(e)));
      } catch (e) { continue; }
      for (const lbl of labels) {
        // ندوّر جوّه أقرب حاوية أب على عنصر دروب/إدخال
        let p = lbl.parentElement;
        for (let up = 0; up < 4 && p; up++, p = p.parentElement) {
          const box = p.querySelector("ng-select, .ng-select, .p-dropdown, select, .mat-select, input:not([type='hidden'])");
          if (box && visible(box)) return box;
        }
      }
    }
    return null;
  }

  function inputByLabel(labelRe) {
    for (const d of docs()) {
      let labels = [];
      try {
        labels = [...d.querySelectorAll("label, span, div, th")]
          .filter((e) => e.children.length === 0 && labelRe.test(txt(e)));
      } catch (e) { continue; }
      for (const lbl of labels) {
        let p = lbl.parentElement;
        for (let up = 0; up < 4 && p; up++, p = p.parentElement) {
          const inp = [...p.querySelectorAll("input")]
            .find((i) => visible(i) && !/hidden|button|submit|checkbox|radio/i.test(i.type || ""));
          if (inp) return inp;
        }
      }
    }
    return null;
  }

  /* ================== التقاط ملف التصدير ================== */
  // WFM بيولّد الملف فى المتصفح (blob) أو بيرجّعه من رابط — بنعترض الاتنين.
  let captured = null;   // { name, blob }
  const onCapture = [];
  function gotFile(name, blob) {
    if (!blob || captured) return;
    captured = { name: name || "wfm_voice_raw.csv", blob };
    console.log("[WFM-VOICE] 📦 اتلقط الملف:", captured.name, blob.size, "bytes");
    onCapture.forEach((f) => { try { f(captured); } catch (e) {} });
  }

  function installHooks(win) {
    try {
      // (1) createObjectURL — أكتر طريقة شائعة للتنزيل من الواجهات الحديثة
      const origCreate = win.URL.createObjectURL.bind(win.URL);
      win.URL.createObjectURL = function (obj) {
        try { if (obj instanceof win.Blob && obj.size > 200) gotFile(null, obj); } catch (e) {}
        return origCreate(obj);
      };
      // (2) fetch — لو الملف بيتجاب من endpoint
      const origFetch = win.fetch;
      if (origFetch) {
        win.fetch = async function (...args) {
          const res = await origFetch.apply(this, args);
          try {
            const ct = (res.headers.get("content-type") || "").toLowerCase();
            const cd = (res.headers.get("content-disposition") || "");
            if (/csv|excel|spreadsheet|octet-stream/.test(ct) || /attachment/i.test(cd)) {
              const c = res.clone();
              c.blob().then((b) => {
                const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
                if (b.size > 200) gotFile(m ? decodeURIComponent(m[1]) : null, b);
              }).catch(() => {});
            }
          } catch (e) {}
          return res;
        };
      }
      // (3) XHR
      const OrigXHR = win.XMLHttpRequest;
      if (OrigXHR) {
        const open = OrigXHR.prototype.open, send = OrigXHR.prototype.send;
        OrigXHR.prototype.open = function (m, u) { this.__u = u; return open.apply(this, arguments); };
        OrigXHR.prototype.send = function () {
          this.addEventListener("load", () => {
            try {
              const cd = this.getResponseHeader("content-disposition") || "";
              const ct = (this.getResponseHeader("content-type") || "").toLowerCase();
              if (/attachment/i.test(cd) || /csv|excel|spreadsheet|octet-stream/.test(ct)) {
                let b = this.response;
                if (typeof b === "string") b = new win.Blob([b], { type: ct || "text/csv" });
                if (b && b.size > 200) {
                  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
                  gotFile(m ? decodeURIComponent(m[1]) : null, b);
                }
              }
            } catch (e) {}
          });
          return send.apply(this, arguments);
        };
      }
      // (4) رابط تحميل مباشر (a[download]) — نجيبه بـ fetch ونلقطه
      win.document.addEventListener("click", (ev) => {
        try {
          const a = ev.target && ev.target.closest && ev.target.closest("a[download],a[href^='blob:']");
          if (!a || !a.href) return;
          origFetch(a.href).then((r) => r.blob()).then((b) => { if (b.size > 200) gotFile(a.getAttribute("download"), b); }).catch(() => {});
        } catch (e) {}
      }, true);
    } catch (e) { console.warn("[WFM-VOICE] hook err", e); }
  }
  installHooks(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);

  /* ================== الرفع لـ Service-Flow ================== */
  function sfUpload(blob, filename) {
    return new Promise((resolve) => {
      try {
        const fd = new FormData();
        fd.append("file", blob, filename);
        GM_xmlhttpRequest({
          method: "POST",
          url: SF_URL + "/api/work-orders/import",
          headers: { "X-Upload-Token": SF_TOKEN },
          data: fd,
          timeout: 300000,
          onload: (r) => {
            console.log("[WFM-VOICE] رفع أوامر الشغل", r.status, (r.responseText || "").slice(0, 300));
            resolve(r.status >= 200 && r.status < 300 ? (r.responseText || "") : null);
          },
          onerror: (r) => { console.warn("[WFM-VOICE] فشل الرفع", r && r.status); resolve(null); },
          ontimeout: () => resolve(null),
        });
      } catch (e) { resolve(null); }
    });
  }

  /* ================== التدفّق الرئيسى ================== */
  let started = false;
  async function runFlow() {
    if (started) return; started = true;

    // 1) Reports فى الشريط الجانبى
    banner("📊 فتح Reports…");
    const reports = await waitFor(() => findByText("a, span, div, li, button", /^\s*Reports\s*$/i, 20), 30000);
    if (reports) { fireClick(reports.closest("a,li,button") || reports); await sleep(1800); }

    // 2) FO Raw Data Reports من قائمة Report Category
    banner("🗂️ اختيار «" + CATEGORY_NAME + "»…");
    const cat = await waitFor(() => findByText("a, span, div, li", /FO\s*Raw\s*Data\s*Reports/i, 40), 25000);
    if (!cat) { banner("❌ مش لاقى «FO Raw Data Reports»", "#b71c1c"); return; }
    fireClick(cat.closest("a,li,div") || cat);
    await sleep(1800);

    // 3) زر «+» بتاع Choose Report
    banner("➕ فتح Choose Report…");
    const plus = await waitFor(() => {
      // الزر الأخضر الصغير جنب "Choose Report"
      const byIcon = qAll("button, a").filter((b) => visible(b) && /^\+?$/.test(txt(b)) &&
        (b.querySelector("i,svg,.fa-plus") || txt(b) === "+"));
      if (byIcon.length) return byIcon[0];
      return findByText("button, a", /^\s*\+\s*$/, 3);
    }, 20000);
    if (!plus) { banner("❌ مش لاقى زر «+»", "#b71c1c"); return; }
    fireClick(plus);
    await sleep(1500);

    // 4) من مودال Choose Report: اختَر اسم التقرير ثم Add Report
    banner("📄 اختيار «" + REPORT_NAME + "»…");
    const sel = await waitFor(() =>
      fieldBoxByLabel(/Report\s*Name/i) || findByText("span, div, input", /Select\s*Report/i, 30), 15000);
    const okPick = await pickFromDropdown(sel, new RegExp(REPORT_NAME.replace(/\s+/g, "\\s*"), "i"));
    if (!okPick) { banner("❌ مش قادر أختار اسم التقرير", "#b71c1c"); return; }
    await sleep(500);
    const addBtn = await waitFor(() => findByText("button, a", /Add\s*Report/i, 25), 10000);
    if (!addBtn) { banner("❌ مش لاقى Add Report", "#b71c1c"); return; }
    fireClick(addBtn);
    await sleep(2500);

    // 5) البارامترات: التواريخ + Sector + Region
    const { from, to } = dateRange();
    banner(`📅 ${isoOf(from)} → ${isoOf(to)} …`);
    const fromIn = await waitFor(() => inputByLabel(/From\s*Date/i), 20000);
    const toIn   = inputByLabel(/To\s*Date/i);
    if (fromIn) setDateInput(fromIn, from);
    if (toIn)   setDateInput(toIn, to);
    await sleep(600);

    banner("🌍 Sector / Region…");
    const secBox = fieldBoxByLabel(/^\s*Sector\s*$/i);
    if (secBox) await pickFromDropdown(secBox, new RegExp(SECTOR.replace(/\s+/g, "\\s*"), "i"));
    await sleep(500);
    const regBox = fieldBoxByLabel(/^\s*Region\s*$/i);
    if (regBox) await pickFromDropdown(regBox, new RegExp(REGION.replace(/\s+/g, "\\s*"), "i"));
    await sleep(600);

    // 6) Generate
    banner("⚙️ Generate…");
    const gen = await waitFor(() => findByText("button, a", /^\s*Generate\s*$/i, 20), 15000);
    if (!gen) { banner("❌ مش لاقى زر Generate", "#b71c1c"); return; }
    fireClick(gen);
    // نستنّى الجدول يظهر (أو على الأقل زر Export يتفعّل)
    await waitFor(() => findByText("button, a", /^\s*Export\s*$/i, 15), 90000);
    await sleep(4000);

    // 7) Export
    banner("⬇️ Export…");
    const exp = await waitFor(() => findByText("button, a", /^\s*Export\s*$/i, 15), 30000);
    if (!exp) { banner("❌ مش لاقى زر Export", "#b71c1c"); return; }
    fireClick(exp);

    // 8) استنى الملف يتلقط ثم ارفعه
    banner("⏳ فى انتظار الملف…");
    const file = await waitFor(() => captured, 120000, 500);
    if (!file) { banner("⚠️ الملف اتحمّل على الجهاز بس مااتلقطش — ارفعه يدوى.", "#ef6c00"); return; }

    banner("📤 رفع الشيت لـ Service-Flow…");
    const resp = await sfUpload(file.blob, file.name || "voice_installation_raw.csv");
    if (!resp) { banner("⚠️ فشل الرفع — الملف موجود فى التحميلات، ارفعه يدوى.", "#ef6c00"); return; }

    let msg = "✅ اتحدّث تقرير أوامر الشغل.";
    try {
      const j = JSON.parse(resp);
      if (j && typeof j.inserted === "number") {
        msg = `✅ اتحدّث تقرير أوامر الشغل — ${j.inserted} أمر` +
              (j.skipped ? ` (تخطّى ${j.skipped})` : "") +
              (j.total ? ` من ${j.total} صف` : "");
      }
    } catch (e) {}
    banner(msg, "#2e7d32");

    if (AUTO_CLOSE_MS > 0) {
      setTimeout(() => { try { window.close(); } catch (e) {} }, AUTO_CLOSE_MS);
    }
  }

  /* ================== الراوتر ================== */
  function boot() {
    if (!document.body) { setTimeout(boot, 200); return; }
    banner("⚙️ WFM — Voice Installation Raw Data");

    const onLogin = () => /#\/login/i.test(location.hash) || qAll("input[type='password']").some(visible);
    if (onLogin()) {
      login();
      // بعد نجاح الدخول الواجهة بتروح للـ Home — نكمّل التدفّق
      waitFor(() => !onLogin(), 90000).then((ok) => { if (ok) setTimeout(runFlow, 2500); });
    } else {
      setTimeout(runFlow, 1500);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // تشغيل يدوى من الكونسول لو حبيت
  window.WFM_VOICE_RUN = () => { started = false; runFlow(); };
})();
