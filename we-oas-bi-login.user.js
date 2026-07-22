// ==UserScript==
// @name         WE OAS BI — دخول تلقائى + تقرير 430D
// @namespace    service-flow.we-oas.login
// @description  يسجّل الدخول على we-oas.te.eg BI، يفتح تقرير «430D Trial - Details متابعة اعطال»، يملأ from_date/to_date ويضغط Apply لتبويبى التفاصيل والمتبقى، ويلتقط ملف Excel الكامل الذى يولّده التقرير نفسه من داخل سياق الصفحة (unsafeWindow) عبر اعتراض XHR/fetch/form مبكراً (document-start)، ينزّله للمراجعة، وبعد تأكيدك يرفعه لموقع Service-Flow.
// @version      1.8.2
// @match        *://we-oas.te.eg/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      service-flow-menoskar42.replit.app
// @connect      replit.app
// @connect      we-oas.te.eg
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  // نعمل داخل سياق الصفحة نفسها (unsafeWindow) عشان هوكات XHR/fetch/form تعترض طلبات
  // الصفحة الحقيقية (فى الـ sandbox كانت بتعترض نسخ معزولة → مكانتش بتشوف التحميل).
  const PAGE = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;

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
  /* ===== التقاط ملف Excel الذى يولّده التقرير نفسه — من داخل سياق الصفحة ===== */
  // المخزن المشترك على أعلى إطار فى سياق الصفحة (PAGE.top) حتى تصبّ فيه كل الإطارات.
  // نخزّن البايتات كـ base64 (نص) لتعبر حاجز الـ sandbox بأمان.
  function caps() {
    let w; try { w = PAGE.top; } catch (e) { w = PAGE; }
    try { if (!w.__430D_caps) w.__430D_caps = []; return w.__430D_caps; }
    catch (e) { if (!PAGE.__430D_caps) PAGE.__430D_caps = []; return PAGE.__430D_caps; }
  }
  function looksExcelUrl(u) {
    return /\.xlsx($|\?)|_xf=(xlsx|excel|analyze)|_xmode=[34]|export|deliver|servlet\/xdo/i.test(u || "");
  }
  // أى رابط تقرير BIP (مش شرط يكون فيه كلمة excel) — نجرّب نجلبه ونشوف إذا كان ملف
  function looksReportUrl(u) {
    return /xmlpserver|servlet\/xdo|_xdo=|_xpt=|_xmode=|bipublisher|deliver|\.xdo/i.test(u || "");
  }
  function u8ToB64(u8) {
    let s = "", CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function b64ToBlob(b64) {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  // تقبل ArrayBuffer أو Blob (أياً كان سياقها) وتخزّن لو التوقيع PK
  async function stashBuf(bufOrBlob, src) {
    try {
      let buf = bufOrBlob;
      if (bufOrBlob && typeof bufOrBlob.arrayBuffer === "function" && typeof bufOrBlob.size === "number") {
        buf = await bufOrBlob.arrayBuffer();   // Blob → ArrayBuffer
      }
      const u8 = new Uint8Array(buf);
      if (u8.length > 200 && u8[0] === 0x50 && u8[1] === 0x4B) {          // PK => xlsx/zip
        const size = u8.length;
        if (!caps().some((c) => c.size === size)) {                       // منع التكرار بالحجم
          caps().push({ size, b64: u8ToB64(u8), src: String(src || "").slice(0, 90) });
          console.log("[430D] ✔ التقطنا ملف xlsx", size, "بايت —", String(src || "").slice(0, 90));
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
  // تصدير الموقع async: xdo(302)→loading.jsp→polling لـ xdo?_xdo= لحد ما الـ job يخلّص.
  // نعمل polling على رابط الـ job كل 1.5ث لحد ما يرجّع ملف PK فعلى (مش رد "بيتولّد").
  const POLLED = new Set();
  function pollForFile(url) {
    if (POLLED.has(url)) return; POLLED.add(url);
    const startN = caps().length;
    let n = 0;
    console.log("[430D] ⏳ poll job:", url.slice(0, 110));
    const timer = setInterval(() => {
      if (caps().length > startN || n++ > 30) { clearInterval(timer); return; }
      try {
        GM_xmlhttpRequest({
          method: "GET", url, responseType: "arraybuffer", timeout: 60000,
          onload: (r) => { if (r.response) stashBuf(r.response, "poll:" + url.slice(0, 60)); },
          onerror: () => {}, ontimeout: () => {},
        });
      } catch (e) {}
    }, 1500);
  }
  // إعادة إرسال فورم التقرير بنفس الحقول للحصول على نفس ملف الـ Excel (attachment)
  function replayForm(form) {
    try {
      if (!form || form.tagName !== "FORM") return;
      const action = form.action || location.href;
      if (!/xmlpserver|servlet\/xdo|saw\.dll|bipublisher|_xdo|analytics/i.test(action)) return;
      const method = (form.method || "GET").toUpperCase();
      const params = new URLSearchParams();
      for (const el of form.elements) {
        if (!el.name || el.disabled) continue;
        if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
        params.append(el.name, el.value != null ? el.value : "");
      }
      const isPost = method === "POST";
      const url = isPost ? action : action + (action.indexOf("?") >= 0 ? "&" : "?") + params.toString();
      console.log("[430D] replayForm", method, action.slice(0, 90), "fields", params.toString().length);
      GM_xmlhttpRequest({
        method, url, responseType: "arraybuffer", timeout: 120000,
        headers: isPost ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
        data: isPost ? params.toString() : undefined,
        onload: (r) => { if (r.response) stashBuf(r.response, "form:" + action.slice(0, 70)); },
        onerror: () => {}, ontimeout: () => {},
      });
    } catch (e) { console.warn("[430D] replayForm err", e); }
  }
  // تركيب الهوكات على نافذة معيّنة w (الإطار الأعلى أو أى iframe same-origin).
  // ده الأهم: التحميل بيحصل جوّه iframe التقرير (xmlpserver) اللى Tampermonkey
  // ساعات مابيحقنش فيه، فبنوصله من الإطار الأعلى ونركّب الهوكات على نافذته.
  function hookWin(w) {
    try { if (!w || w.__430D_hooked) return; w.__430D_hooked = true; } catch (e) { return; }
    try {
      const XHR = w.XMLHttpRequest, XO = XHR.prototype.open, XS = XHR.prototype.send;
      XHR.prototype.open = function (m, u) { this.__u = u; return XO.apply(this, arguments); };
      XHR.prototype.send = function () {
        this.addEventListener("load", () => { try { const r = this.response; if (r) stashBuf(r, "xhr:" + (this.__u || "")); } catch (e) {} });
        return XS.apply(this, arguments);
      };
    } catch (e) {}
    try {
      const F = w.fetch;
      if (F) w.fetch = function (i) {
        const u = (typeof i === "string" ? i : (i && i.url)) || "";
        return F.apply(this, arguments).then((resp) => { try { resp.clone().arrayBuffer().then((b) => stashBuf(b, "fetch:" + u)); } catch (e) {} return resp; });
      };
    } catch (e) {}
    try { const CO = w.URL.createObjectURL; w.URL.createObjectURL = function (o) { try { if (o && typeof o.arrayBuffer === "function") stashBuf(o, "objurl"); } catch (e) {} return CO.apply(this, arguments); }; } catch (e) {}
    try { const OP = w.open; w.open = function (u) { try { if (u && looksReportUrl(u)) refetch(u); } catch (e) {} return OP.apply(this, arguments); }; } catch (e) {}
    try { w.document.addEventListener("submit", (ev) => { replayForm(ev.target); }, true); } catch (e) {}
    try { const FE = w.HTMLFormElement; const FS = FE.prototype.submit; FE.prototype.submit = function () { try { replayForm(this); } catch (e) {} return FS.apply(this, arguments); }; } catch (e) {}
    try { const FE = w.HTMLFormElement; const RS = FE.prototype.requestSubmit; if (RS) FE.prototype.requestSubmit = function () { try { replayForm(this); } catch (e) {} return RS.apply(this, arguments); }; } catch (e) {}
    try {
      const IE = w.HTMLIFrameElement;
      const dsc = Object.getOwnPropertyDescriptor(IE.prototype, "src");
      if (dsc && dsc.set) Object.defineProperty(IE.prototype, "src", {
        configurable: true, enumerable: dsc.enumerable,
        get() { return dsc.get.call(this); },
        set(v) { try { if (looksReportUrl(v)) { console.log("[430D] iframe→", String(v).slice(0, 110)); refetch(v); } } catch (e) {} return dsc.set.call(this, v); },
      });
    } catch (e) {}
    // اعتراض تغيير location داخل الإطار (التصدير أحياناً location.assign/replace)
    try { const LA = w.location.assign.bind(w.location); w.location.assign = function (u) { try { if (looksReportUrl(u)) refetch(u); } catch (e) {} return LA(u); }; } catch (e) {}
    try { const LR = w.location.replace.bind(w.location); w.location.replace = function (u) { try { if (looksReportUrl(u)) refetch(u); } catch (e) {} return LR(u); }; } catch (e) {}
    console.log("[430D] ✅ hooked window @", (function () { try { return (w.location.href || "").slice(0, 60); } catch (e) { return "?"; } })());
  }
  // اهوك كل الإطارات same-origin (الحالية) — بننده عليها دورياً لالتقاط إطارات جديدة
  function hookAllFrames(w) {
    w = w || PAGE;
    try { hookWin(w); } catch (e) {}
    let frames = [];
    try { frames = w.frames; } catch (e) {}
    try {
      for (let i = 0; i < (frames ? frames.length : 0); i++) {
        let cw = null; try { cw = frames[i]; } catch (e) {}
        if (cw) { try { hookWin(cw); } catch (e) {} try { hookAllFrames(cw); } catch (e) {} }
      }
    } catch (e) {}
  }
  function installCapture() {
    hookAllFrames(PAGE);
    try { if (!PAGE.__430D_poll) { PAGE.__430D_poll = setInterval(() => { try { hookAllFrames(PAGE); } catch (e) {} }, 1000); } } catch (e) {}
  }
  // تشخيص: اطبع كل روابط الشبكة (لمعرفة رابط تنزيل الملف لو فشل الالتقاط)
  function dumpPerfUrls() {
    const wins = []; try { wins.push(PAGE.top); } catch (e) { wins.push(PAGE); }
    for (const d of docsList()) { try { if (d.defaultView) wins.push(d.defaultView); } catch (e) {} }
    const all = [];
    for (const w of wins) { try { for (const en of w.performance.getEntriesByType("resource")) all.push(en.name); } catch (e) {} }
    console.log("[430D] 🔎 آخر روابط الشبكة (" + all.length + " إجمالى) — ابعتهالى:");
    all.slice(-45).forEach((u, i) => console.log("   ", i, u));
  }
  // فحص سجلّ الأداء (كل الإطارات) لأى رابط تنزيل Excel ثم إعادة جلبه بالكوكيز
  function scanPerfAndRefetch() {
    const seen = caps().__seen || (caps().__seen = new Set());
    const wins = []; try { wins.push(PAGE.top); } catch (e) { wins.push(PAGE); }
    for (const d of docsList()) { try { if (d.defaultView) wins.push(d.defaultView); } catch (e) {} }
    let n = 0;
    const tryUrl = (u, tag) => {
      if (!looksReportUrl(u) || /\.(gif|png|jpg|jpeg|css|js|woff2?|ico)(\?|$)/i.test(u)) return;
      // روابط الـ job غير المتزامن: نعمل عليها polling (مش refetch مرة واحدة)
      if (/loading\.jsp|xdo\?_xdo=|\/xdo\?/i.test(u)) { pollForFile(u); n++; return; }
      if (!seen.has(u)) { seen.add(u); console.log("[430D] " + tag, u.slice(0, 130)); refetch(u); n++; }
    };
    for (const w of wins) {
      for (const type of ["resource", "navigation"]) {
        let ents = []; try { ents = w.performance.getEntriesByType(type); } catch (e) {}
        for (const en of ents) tryUrl(en.name || "", "perf-url");
      }
    }
    // src بتاع كل iframe (docframe التقرير بيتوجّه لرابط التصدير)
    for (const fr of qAll("iframe,frame")) { try { tryUrl(fr.getAttribute("src") || fr.src || "", "iframe-src"); } catch (e) {} }
    return n;
  }
  async function waitNewCap(before, ms) {
    return await waitFor(() => { scanPerfAndRefetch(); return caps().length > before ? caps()[caps().length - 1] : null; }, ms);
  }
  // يجمع كل روابط الشبكة المتعلقة بالتقرير من كل الإطارات (resource + navigation)
  function collectReportUrls() {
    const wins = []; try { wins.push(PAGE.top); } catch (e) { wins.push(PAGE); }
    try { const fr = PAGE.top.frames; for (let i = 0; i < fr.length; i++) { try { wins.push(fr[i]); } catch (e) {} } } catch (e) {}
    for (const d of docsList()) { try { if (d.defaultView) wins.push(d.defaultView); } catch (e) {} }
    const set = new Set();
    const keep = (u) => { if (u && /xmlpserver|saw\.dll|\.xdo|_xpt|_xmode|servlet\/xdo|deliver|export/i.test(u) && !/\.(gif|png|jpg|jpeg|css|js|woff2?|ico)(\?|$)/i.test(u)) set.add(u); };
    for (const w of wins) {
      for (const type of ["resource", "navigation"]) {
        let ents = []; try { ents = w.performance.getEntriesByType(type); } catch (e) {}
        for (const en of ents) keep(en.name || "");
      }
    }
    // كمان: src بتاع كل iframe (docframe بعد التصدير = رابط الملف)
    for (const fr of qAll("iframe,frame")) { try { keep(fr.getAttribute("src") || fr.src || ""); } catch (e) {} }
    return [...set];
  }
  // صندوق ظاهر على الصفحة يعرض الروابط (بدل الكونسول) — تصوّره وابعتهولى
  function showUrlsOverlay(list) {
    try {
      const old = document.getElementById("sf430-urls"); if (old) old.remove();
      const box = document.createElement("div");
      box.id = "sf430-urls";
      box.style.cssText = "position:fixed;top:36px;left:8px;right:8px;bottom:8px;z-index:2147483647;background:#fff;border:3px solid #c62828;border-radius:8px;padding:8px;overflow:auto;direction:ltr;font:12px/1.5 monospace;color:#111;box-shadow:0 6px 30px rgba(0,0,0,.5)";
      const head = document.createElement("div");
      head.style.cssText = "direction:rtl;font:bold 13px Arial;color:#c62828;margin-bottom:6px";
      head.textContent = "🔎 روابط شبكة التقرير — صوّر الصورة دى وابعتهالى (اقفلها من X):";
      const x = document.createElement("button");
      x.textContent = "✖ إغلاق"; x.style.cssText = "float:left;background:#c62828;color:#fff;border:0;border-radius:5px;padding:3px 8px;cursor:pointer";
      x.onclick = () => box.remove();
      head.appendChild(x); box.appendChild(head);
      const ta = document.createElement("textarea");
      ta.readOnly = true; ta.style.cssText = "width:100%;height:calc(100% - 34px);border:1px solid #ccc;font:11px/1.4 monospace;white-space:pre;direction:ltr";
      ta.value = list.length ? list.map((u, i) => (i + 1) + ") " + decodeURIComponent(u)).join("\n\n") : "(لا توجد روابط تقرير فى سجل الأداء — التحميل غالباً مباشر بدون تسجيل)";
      box.appendChild(ta);
      (document.body || document.documentElement).appendChild(box);
      ta.focus(); ta.select();
    } catch (e) { console.warn("overlay err", e); }
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

  // خانة التاريخ: باللابل المجاور أولاً (الطريقة اللى كانت بتكتب صح) ثم name/id احتياطياً
  function findDateInput(re) {
    const byLabel = findLabeledInput(re);
    if (byLabel) return byLabel;
    return qAll("input").find((i) => visible(i) && i.type !== "hidden" && re.test((i.name || "") + " " + (i.id || "")));
  }
  // يضغط Apply: بالنص، أو بالـ id (reportViewApply)، أو ينادى validateAndRun() فى إطار التقرير
  function clickApply() {
    let btn = findBtn(/^\s*apply\s*$/i);
    if (!btn) btn = qAll("button, input[type='button'], input[type='submit']").find((b) => visible(b) && (b.id || "") === "reportViewApply");
    if (btn) { clickEl(btn); return true; }
    // fallback: نادِ الدالة الداخلية للموقع مباشرةً
    let called = false;
    for (const d of docsList()) {
      try { const w = d.defaultView; if (w && typeof w.validateAndRun === "function") { w.validateAndRun(); called = true; } } catch (e) {}
    }
    return called;
  }
  // يملأ التواريخ (بمحاولات) ثم يضغط Apply (اللى بيولّد التقرير وينزّل الـ Excel)
  async function fillDatesAndApply() {
    for (let t = 0; t < 4; t++) {
      closeDatePopup();
      const fromI = findDateInput(/from_?date/i);
      const toI = findDateInput(/to_?date/i);
      if (fromI) setValue(fromI, FROM_STR);
      if (toI) setValue(toI, TO_STR);
      closeDatePopup();
      const okFrom = fromI && String(fromI.value || "").trim();
      const okTo = toI && String(toI.value || "").trim();
      if (okFrom && okTo) break;
      await sleep(500);
    }
    await sleep(500);
    const clicked = clickApply();
    console.log("[430D] Apply", clicked ? "مضغوط" : "مش لاقيه");
    return clicked;
  }
  function findTab(re) {
    const cands = qAll("a, span, div, td, li, button").filter((e) => visible(e) && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 40);
    if (!cands.length) return null;
    // فضّل العنصر الأصغر (لينك التبويب الفعلى) بدل الحاوية
    cands.sort((a, b) => { let n = 0; try { n = a.querySelectorAll("*").length - b.querySelectorAll("*").length; } catch (e) {} return n || (a.tagName === "A" ? -1 : b.tagName === "A" ? 1 : 0); });
    return cands[0];
  }
  // زر التصدير فى شريط أدوات BIP (أيقونة Excel الخضراء id=xdo:viewFormatLink)
  // → قائمة (Interactive/HTML/PDF/Excel) → نضغط Excel (*.xlsx)
  function exportExcelViaToolbar() {
    // لو القائمة مفتوحة: دوس Excel (*.xlsx)
    const item = qAll("a, span, div, li, button, td").find((e) => visible(e) && /excel/i.test(e.textContent || "") && /xlsx|2007|\.xls/i.test(e.textContent || ""));
    if (item) { clickEl(item); console.log("[430D] ضغط Excel (*.xlsx) من القائمة"); return true; }
    // افتح أيقونة التصدير: بالـ id (viewFormat) أو بصورة preview_excel أو class imageButton
    let icon = qAll("a, img, span, div, button").find((e) => visible(e) &&
      /viewformat|export|تصدير/i.test((e.id || "") + " " + (e.title || "") + " " + ((e.getAttribute && e.getAttribute("aria-label")) || "")));
    if (!icon) icon = qAll("img").find((e) => visible(e) && /preview_excel|viewformat|xlsx|excel/i.test((e.src || "") + " " + (e.id || "")));
    if (icon) { clickEl((icon.closest && icon.closest("a")) || icon); console.log("[430D] فتحت قائمة التصدير"); return "menu"; }
    return false;
  }
  // يفتح قائمة التصدير ويضغط Excel (بمحاولات) — يسبّب التنزيل الأصلى للملف
  async function triggerExcelExport() {
    for (let t = 0; t < 4; t++) {
      const r = exportExcelViaToolbar();
      if (r === true) return true;      // ضغطنا Excel
      if (r === "menu") { await sleep(1000); continue; }  // القائمة فتحت — نعيد لنضغط Excel
      await sleep(700);
    }
    return false;
  }

  /* ============ 2) صفحة التقرير: تواريخ + Apply لكل تبويب مع التقاط الملف ============ */
  async function reportFlow() {
    installCapture();
    caps().length = 0; if (caps().__seen) caps().__seen.clear();   // ابدأ نظيف

    const apply = await waitFor(() => findBtn(/^\s*apply\s*$/i), 40000);
    if (!apply) { banner("⚠️ مفيش زر Apply — الصفحة مش صح؟", "#ef6c00"); clearFlag(); return; }

    // (أ) تبويب التفاصيل — تواريخ + Apply → استنى التقرير يتولّد → صدّر Excel (تنزيل)
    banner("📅 التفاصيل: تواريخ + Apply (" + FROM_STR + " → " + TO_STR + ")…");
    let before = caps().length;
    await fillDatesAndApply();
    banner("⏳ التفاصيل: بيتولّد…");
    await sleep(6000);
    banner("📤 التفاصيل: تصدير Excel…");
    await triggerExcelExport();
    await waitNewCap(before, 12000);   // فرصة التقاط للرفع التلقائى (لو نجح)

    // (ب) تبويب المتبقى — افتحه ثم تواريخ + Apply → صدّر Excel (تنزيل)
    banner("🔀 فتح تبويب «المتبقى»…");
    const remTab = findTab(/متبقى|متبقي|remaining/i);
    if (remTab) { clickEl(remTab); await sleep(2500); }
    banner("📅 المتبقى: تواريخ + Apply…");
    before = caps().length;
    await fillDatesAndApply();
    banner("⏳ المتبقى: بيتولّد…");
    await sleep(6000);
    banner("📤 المتبقى: تصدير Excel…");
    await triggerExcelExport();
    await waitNewCap(before, 12000);

    // (ج) فحص أخير للأداء (يلتقط أى تنزيل متأخر)
    for (let i = 0; i < 6; i++) { scanPerfAndRefetch(); await sleep(1200); }

    // (د) جهّز الملفات الملتقطة (b64 → Blob فى الـ sandbox) — أول ملف=التفاصيل، تانى=المتبقى
    const snap = caps().slice();
    const got = snap.map((c, idx) => {
      const label = idx === 0 ? "التفاصيل" : "المتبقى";
      const name = "430D_" + (idx === 0 ? "details" : "remaining") + "_" + FROM_STR + "_" + TO_STR + ".xlsx";
      const blob = b64ToBlob(c.b64);
      return { label, blob, name, kb: Math.round(blob.size / 1024) };
    });
    if (!got.length) {
      // التنزيل الأصلى نجح (الملفان اتحمّلوا على الجهاز) — الرفع التلقائى متعذّر
      // بسبب آلية الـ job/التوكن، فنوجّه المستخدم يرفعهم يدوياً بالرفعة المتعددة.
      banner("✅ اتحمّل التفاصيل + المتبقى على جهازك — ارفعهم من «رفع 430D» (تقدر تعلّم عليهم الاتنين مرة واحدة)", "#2e7d32");
      clearFlag(); return;
    }

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
  installCapture();   // ركّب الالتقاط (سياق الصفحة) فى كل إطار قبل أى تحميل — document-start
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
