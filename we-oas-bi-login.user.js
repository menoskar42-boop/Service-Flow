// ==UserScript==
// @name         WE OAS BI — دخول تلقائى + تقرير 430D
// @namespace    service-flow.we-oas.login
// @description  يسجّل الدخول على we-oas.te.eg BI، يفتح تقرير «430D Trial - Details متابعة اعطال»، يملأ from_date/to_date ويضغط Apply لتبويبى التفاصيل والمتبقى، ويلتقط ملف Excel الكامل الذى يولّده التقرير نفسه (عبر اعتراض XHR/fetch/objectURL + فحص سجلّ الأداء)، ينزّله للمراجعة، وبعد تأكيدك يرفعه لموقع Service-Flow.
// @version      1.5.0
// @match        *://we-oas.te.eg/*
// @grant        GM_xmlhttpRequest
// @connect      service-flow-menoskar42.replit.app
// @connect      replit.app
// @connect      we-oas.te.eg
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mena.haleem@te.eg";
  const PASS = "Mon_oskar364";
  const SF_URL   = "https://service-flow-menoskar42.replit.app";
  const SF_TOKEN = "sf-auto-upload-2026";

  // رفع Blob (ملف xlsx كامل من الخادم) لمسار الاستيراد الذكى. يرجّع Promise<boolean>.
  function uploadBlobToSF(blob, filename) {
    return new Promise((resolve) => {
      try {
        const fd = new FormData(); fd.append("file", blob, filename);
        GM_xmlhttpRequest({
          method: "POST", url: SF_URL + "/api/complaint-details/import",
          headers: { "X-Upload-Token": SF_TOKEN },
          data: fd, timeout: 120000,
          onload: (r) => { console.log("[430D] SF upload", filename, r.status, (r.responseText || "").slice(0, 220)); resolve(r.status >= 200 && r.status < 300); },
          onerror: (r) => { console.warn("[430D] SF error", r && r.status); resolve(false); },
          ontimeout: () => { console.warn("[430D] SF timeout"); resolve(false); },
        });
      } catch (e) { console.warn("[430D] upload exception", e); resolve(false); }
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { try { return !!el && el.getClientRects().length > 0; } catch (e) { return false; } };

  function setValue(input, value) {
    try { input.focus(); } catch (e) {}
    try {
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    } catch (e) { input.value = value; }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function findUserField(passField) {
    const all = [...document.querySelectorAll("input")].filter(visible);
    const byName = all.find((i) => /user|login|email|acc/i.test((i.name || "") + (i.id || "")) && !/password|pass/i.test(i.type));
    if (byName) return byName;
    if (passField) {
      const before = all.slice(0, all.indexOf(passField)).reverse().find((i) => !/password/i.test(i.type) && /text|email|^$/i.test(i.type || "text"));
      if (before) return before;
    }
    return all.find((i) => /text|email/i.test(i.type || "text")) || all[0] || null;
  }

  function findSignInBtn() {
    const re = /sign\s*in|log\s*in|login|دخول|تسجيل/i;
    const els = [...document.querySelectorAll("button, input[type='submit'], input[type='button'], a")].filter(visible);
    return els.find((b) => re.test((b.textContent || b.value || "").trim())) || els.find((b) => /submit/i.test(b.type)) || null;
  }

  /* ================== أدوات عامة + عبر الـ iframes ================== */
  async function waitFor(fn, ms) {
    const end = Date.now() + (ms || 15000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(250); }
    return null;
  }
  function docsList() {
    const out = [document];
    const walk = (root) => {
      let ifr = [];
      try { ifr = [...root.querySelectorAll("iframe,frame")]; } catch (e) {}
      for (const f of ifr) { let d = null; try { d = f.contentDocument; } catch (e) {} if (d && out.indexOf(d) === -1) { out.push(d); walk(d); } }
    };
    walk(document);
    return out;
  }
  function qAll(sel) { const r = []; for (const d of docsList()) { try { r.push(...d.querySelectorAll(sel)); } catch (e) {} } return r; }
  function findBtn(re) { return qAll("button, input[type='submit'], input[type='button'], a").find((b) => visible(b) && re.test((b.textContent || b.value || "").trim())) || null; }
  function clickEl(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    try { el.focus(); } catch (e) {}
    const opts = { bubbles: true, cancelable: true, view: window };
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try { const Ev = t.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent; el.dispatchEvent(new Ev(t, opts)); }
      catch (e) { try { el.dispatchEvent(new MouseEvent(t.replace("pointer", "mouse"), opts)); } catch (e2) {} }
    }
    try { if (typeof el.click === "function") el.click(); } catch (e) {}
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") { try { form.requestSubmit(el.type === "submit" ? el : undefined); } catch (e) {} }
    return true;
  }
  // الخانة التى تلى اللابل (from_date/to_date) مباشرةً
  function findLabeledInput(re) {
    for (const d of docsList()) {
      let lbl;
      try { lbl = [...d.querySelectorAll("*")].find((e) => e.children.length === 0 && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 20); } catch (e) {}
      if (!lbl) continue;
      let inputs = [];
      try { inputs = [...d.querySelectorAll("input")].filter((i) => visible(i) && i.type !== "hidden" && i.type !== "button" && i.type !== "submit" && i.type !== "checkbox" && i.type !== "radio"); } catch (e) {}
      const following = inputs.filter((i) => lbl.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (following.length) return following[0];
      if (inputs.length) return inputs[0];
    }
    return null;
  }
  function closeDatePopup() {
    for (const d of docsList()) {
      let dlg;
      try { dlg = [...d.querySelectorAll("*")].find((e) => visible(e) && /select\s*date\s*and\s*time/i.test(e.textContent || "") && (e.textContent || "").length < 500); } catch (e) {}
      if (dlg) {
        const scope = dlg.closest("div,table,body") || d;
        const cancel = [...scope.querySelectorAll("button,input[type='button']")].find((b) => visible(b) && /^\s*cancel\s*$/i.test((b.textContent || b.value || "")));
        if (cancel) clickEl(cancel);
      }
    }
  }

  // مسار تقرير الـ Trial (Excel كامل بكل الأعمدة) + لينك فتحه من الكتالوج
  const XDO_PATH = "/FCC Prod/430D Trial القطاع-TEDATA - Details متابعة اعطال.xdo";
  const REPORT_URL = "https://we-oas.te.eg/analytics/saw.dll?bipublisherEntry&action=open&bippath=" + encodeURIComponent(XDO_PATH) + "&itemtype=.xdo";

  /* ================== التواريخ (MM-DD-YYYY زى الموقع) ================== */
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "-" + d.getFullYear();
  const NOW = new Date();
  const TO_STR = fmtDate(NOW);
  const FROM_STR = fmtDate(NOW.getDate() <= 7 ? new Date(NOW.getFullYear(), NOW.getMonth() - 1, 25) : new Date(NOW.getFullYear(), NOW.getMonth(), 1));

  /* ================== جلب Excel مباشرة من xmlpserver (كل الأعمدة) ================== */
  // _xpt = رقم التبويب (0=التفاصيل، 1=تفاصيل المتبقى) — من الـ Network
  /* ===== التقاط ملف Excel الذى يولّده التقرير نفسه (كل الآليات الممكنة) ===== */
  // مخزن مشترك على أعلى إطار حتى تصبّ فيه نسخ السكربت داخل الـ iframes
  function caps() {
    try { const w = window.top; if (!w.__430D_caps) w.__430D_caps = []; return w.__430D_caps; }
    catch (e) { if (!window.__430D_caps) window.__430D_caps = []; return window.__430D_caps; }
  }
  function looksExcelUrl(u) {
    return /\.xlsx($|\?)|_xf=(xlsx|excel|analyze)|_xmode=[34]|export|deliver|servlet\/xdo/i.test(u || "");
  }
  async function stashBuf(buf, src) {
    try {
      const u8 = new Uint8Array(buf);
      if (u8.length > 200 && u8[0] === 0x50 && u8[1] === 0x4B) {          // PK => xlsx/zip
        const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        if (!caps().some((c) => c.size === blob.size)) {                  // منع التكرار بالحجم
          caps().push({ blob, size: blob.size, src: src || "" });
          console.log("[430D] ✔ التقطنا ملف xlsx", blob.size, "بايت —", (src || "").slice(0, 90));
        }
        return true;
      }
    } catch (e) {}
    return false;
  }
  function refetch(url) {
    try {
      GM_xmlhttpRequest({
        method: "GET", url, responseType: "arraybuffer", timeout: 120000,
        onload: (r) => { if (r.response) stashBuf(r.response, "refetch:" + url.slice(0, 80)); },
        onerror: () => {}, ontimeout: () => {},
      });
    } catch (e) {}
  }
  function installCapture() {
    if (window.__430D_hooked) return; window.__430D_hooked = true;
    try {
      const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return XO.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        this.addEventListener("load", () => {
          try {
            const r = this.response;
            if (r instanceof Blob) r.arrayBuffer().then((b) => stashBuf(b, "xhr:" + (this.__u || "")));
            else if (r instanceof ArrayBuffer) stashBuf(r, "xhr:" + (this.__u || ""));
          } catch (e) {}
        });
        return XS.apply(this, arguments);
      };
    } catch (e) {}
    try {
      const F = window.fetch;
      if (F) window.fetch = function (i) {
        const u = (typeof i === "string" ? i : (i && i.url)) || "";
        return F.apply(this, arguments).then((resp) => {
          try { resp.clone().arrayBuffer().then((b) => stashBuf(b, "fetch:" + u)); } catch (e) {}
          return resp;
        });
      };
    } catch (e) {}
    try {
      const CO = URL.createObjectURL;
      URL.createObjectURL = function (o) { try { if (o instanceof Blob) o.arrayBuffer().then((b) => stashBuf(b, "objurl")); } catch (e) {} return CO.apply(this, arguments); };
    } catch (e) {}
    try {
      const AC = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { try { if (/^https?:/i.test(this.href) && (this.download || looksExcelUrl(this.href))) refetch(this.href); } catch (e) {} return AC.apply(this, arguments); };
    } catch (e) {}
    try { const OP = window.open; window.open = function (u) { try { if (u && looksExcelUrl(u)) refetch(u); } catch (e) {} return OP.apply(this, arguments); }; } catch (e) {}
    console.log("[430D] ✅ interceptors مركّبة @", location.href.slice(0, 60));
  }
  // فحص سجلّ الأداء (كل الإطارات) لأى رابط تنزيل Excel ثم إعادة جلبه بالكوكيز
  function scanPerfAndRefetch() {
    const seen = caps().__seen || (caps().__seen = new Set());
    const wins = []; try { wins.push(window.top); } catch (e) { wins.push(window); }
    for (const d of docsList()) { try { if (d.defaultView) wins.push(d.defaultView); } catch (e) {} }
    let n = 0;
    for (const w of wins) {
      for (const type of ["resource", "navigation"]) {
        let ents = []; try { ents = w.performance.getEntriesByType(type); } catch (e) {}
        for (const en of ents) {
          const u = en.name || "";
          if (looksExcelUrl(u) && !seen.has(u)) { seen.add(u); console.log("[430D] perf-url", u.slice(0, 120)); refetch(u); n++; }
        }
      }
    }
    return n;
  }
  async function waitNewCap(before, ms) {
    return await waitFor(() => { scanPerfAndRefetch(); return caps().length > before ? caps()[caps().length - 1] : null; }, ms);
  }
  function saveBlob(blob, name) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name;
      (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (e) { console.warn("save err", e); }
  }

  /* ================== علامة التشغيل التلقائى عبر الصفحات ================== */
  const FLAG = "WEOAS_AUTO_430D";
  const setFlag = () => { try { localStorage.setItem(FLAG, String(Date.now() + 8 * 60 * 1000)); } catch (e) {} };
  const flagOn = () => { try { return parseInt(localStorage.getItem(FLAG) || "0", 10) > Date.now(); } catch (e) { return false; } };
  const clearFlag = () => { try { localStorage.removeItem(FLAG); } catch (e) {} };

  /* ================== شريط حالة + زر يدوى ================== */
  let bar, btnStart;
  function ui() {
    if (bar) return;
    bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:7px 12px;font:bold 13px Arial;color:#fff;background:#6a1b9a;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    bar.textContent = "⚙️ WE OAS — 430D";
    btnStart = document.createElement("button");
    btnStart.textContent = "▶️ ابدأ تقرير 430D";
    btnStart.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:12px 18px;border:0;border-radius:10px;background:#6a1b9a;color:#fff;font:bold 14px Arial;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45);direction:rtl";
    btnStart.onclick = () => { btnStart.disabled = true; kickoff(true).catch((e) => banner("❌ " + (e && e.message || e), "#c62828")); };
    (document.body || document.documentElement).appendChild(bar);
    (document.body || document.documentElement).appendChild(btnStart);
  }
  function banner(msg, color) { ui(); bar.style.background = color || "#6a1b9a"; bar.textContent = msg; console.log("[430D]", msg); }

  /* ================== 1) تسجيل الدخول ================== */
  let done = false;
  async function autoLogin() {
    if (done) return;
    setFlag();
    const pass = await waitFor(() => { const p = document.querySelector("input[type='password']"); return p && visible(p) ? p : null; }, 20000);
    if (!pass) return;
    const user = findUserField(pass);
    if (user) setValue(user, USER);
    setValue(pass, PASS);
    await sleep(400);
    const btn = findSignInBtn();
    done = true;
    if (btn) clickEl(btn);
    else pass.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true }));
  }

  async function homeFlow() { banner("📂 فتح التقرير باللينك المباشر…"); location.href = REPORT_URL; }

  // يملأ التواريخ ثم يضغط Apply (اللى بيولّد التقرير وينزّل الـ Excel تلقائياً)
  async function fillDatesAndApply() {
    closeDatePopup();
    const fromI = findLabeledInput(/from_?date/i);
    const toI = findLabeledInput(/to_?date/i);
    if (fromI) setValue(fromI, FROM_STR);
    if (toI) setValue(toI, TO_STR);
    closeDatePopup();
    await sleep(700);
    const btn = findBtn(/^\s*apply\s*$/i);
    if (btn) clickEl(btn);
    return !!btn;
  }
  function findTab(re) {
    return qAll("a, span, div, td, li, button").find((e) => visible(e) && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 40) || null;
  }

  /* ============ 2) صفحة التقرير: تواريخ + Apply لكل تبويب مع التقاط الملف ============ */
  async function reportFlow() {
    installCapture();
    caps().length = 0; if (caps().__seen) caps().__seen.clear();   // ابدأ نظيف

    const apply = await waitFor(() => findBtn(/^\s*apply\s*$/i), 40000);
    if (!apply) { banner("⚠️ مفيش زر Apply — الصفحة مش صح؟", "#ef6c00"); clearFlag(); return; }

    // (أ) تبويب التفاصيل — Apply ثم انتظر التقاط الملف
    banner("📅 التفاصيل: تواريخ + Apply (" + FROM_STR + " → " + TO_STR + ")…");
    await fillDatesAndApply();
    banner("⏳ انتظار تنزيل ملف التفاصيل…");
    await waitNewCap(caps().length, 45000);

    // (ب) تبويب المتبقى — افتحه ثم Apply
    banner("🔀 فتح تبويب «المتبقى»…");
    const remTab = findTab(/متبقى|متبقي|remaining/i);
    if (remTab) { clickEl(remTab); await sleep(1800); }
    banner("📅 المتبقى: تواريخ + Apply…");
    await fillDatesAndApply();
    banner("⏳ انتظار تنزيل ملف المتبقى…");
    await waitNewCap(caps().length, 45000);

    // (ج) فحص أخير للأداء (يلتقط أى تنزيل متأخر)
    for (let i = 0; i < 6; i++) { scanPerfAndRefetch(); await sleep(1200); }

    // (د) جهّز الملفات الملتقطة (مرتّبة: أول ملف = التفاصيل، تانى = المتبقى)
    const uniq = caps();
    const got = uniq.map((c, idx) => {
      const label = idx === 0 ? "التفاصيل" : "المتبقى";
      const name = "430D_" + (idx === 0 ? "details" : "remaining") + "_" + FROM_STR + "_" + TO_STR + ".xlsx";
      return { label, blob: c.blob, name, kb: Math.round(c.blob.size / 1024) };
    });
    if (!got.length) { banner("❌ لم يُلتقط أى ملف — افتح Console وابعتلى سطور [430D] perf-url", "#c62828"); clearFlag(); return; }

    // (هـ) نزّلهم للمراجعة على الجهاز
    for (const g of got) saveBlob(g.blob, g.name);
    const summary = got.map((g) => g.label + " (" + g.kb + "KB)").join(" + ");
    banner("📥 اتحمّل: " + summary + " — راجع الملفات", "#2e7d32");
    const proceed = confirm("اتحمّل على جهازك:\n" + got.map((g) => "• " + g.name + " (" + g.kb + " KB)").join("\n") + "\n\nراجع البيانات. أرفعهم للموقع دلوقتى؟");
    if (!proceed) { banner("⏸️ اتلغى الرفع — الملفات اتحمّلت للمراجعة بس.", "#607d8b"); clearFlag(); return; }
    // (4) الرفع للموقع
    let okAll = true;
    for (const g of got) {
      banner("📤 رفع " + g.label + "…");
      const ok = await uploadBlobToSF(g.blob, g.name);
      if (!ok) okAll = false;
    }
    banner(okAll ? "✅ اتحدّث الموقع بالملفات كاملة (" + summary + ")." : "⚠️ رفع بعض الملفات فشل — راجع الكونسول.", okAll ? "#2e7d32" : "#ef6c00");
    clearFlag();
  }

  /* ================== الراوتر ================== */
  installCapture();   // ركّب الالتقاط فى كل إطار (بما فيها iframe التقرير) قبل أى تحميل
  const path = location.pathname + location.search;
  const isLogin  = /bi-security-login/i.test(path);
  const isReport = /saw\.dll|\/analytics\//i.test(path);
  const isHome   = !isReport && (/\/dv\//i.test(path) || /home\.jsp/i.test(path));

  function pageText() { let s = ""; for (const d of docsList()) { try { s += " " + (d.body ? d.body.innerText : ""); } catch (e) {} } return s; }
  async function is430ReportPage() {
    return await waitFor(() => {
      const t = pageText();
      if (/P_CABINET_NO|نحاسى?/i.test(t)) return false;   // ده تقرير 131 مش بتاعنا
      if (/from_?date/i.test(t) && /to_?date/i.test(t)) return true;
      return null;
    }, 20000);
  }
  let started = false;
  async function kickoff(manual) {
    if (started) return; started = true;
    if (isReport) await reportFlow();
    else if (isHome) await homeFlow();
  }

  if (isLogin) {
    autoLogin();
  } else if (isHome) {
    ui();
    if (flagOn()) waitFor(() => document.body, 10000).then(() => sleep(1800)).then(() => kickoff(false)).catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
  } else if (isReport) {
    is430ReportPage().then((ok) => {
      if (!ok) return;
      ui();
      if (flagOn()) sleep(800).then(() => kickoff(false)).catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
    }).catch(() => {});
  }
})();
