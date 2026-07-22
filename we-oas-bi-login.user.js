// ==UserScript==
// @name         WE OAS BI — دخول تلقائى + تقرير 430D
// @namespace    service-flow.we-oas.login
// @description  يسجّل الدخول على we-oas.te.eg BI، يجلب تقرير «430D Trial - Details متابعة اعطال» كملفات Excel كاملة (كل الأعمدة) مباشرةً من xmlpserver للتفاصيل والمتبقى، ينزّلهم على الجهاز للمراجعة، وبعد تأكيدك يرفعهم لموقع Service-Flow.
// @version      1.4.0
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
  // رفع البيانات لموقع Service-Flow (نفس توكن الرفع التلقائى المستخدم فى باقى السكربتات)
  const SF_URL   = "https://service-flow-menoskar42.replit.app";
  const SF_TOKEN = "sf-auto-upload-2026";
  // يرفع ملف XLS (بشيتين: التفاصيل + تفاصيل متبقى) لمسار الاستيراد الذكى. يرجّع Promise<boolean>.
  function uploadToSF(xmlContent, filename) {
    return new Promise((resolve) => {
      try {
        const blob = new Blob(["﻿" + xmlContent], { type: "application/vnd.ms-excel" });
        const fd = new FormData(); fd.append("file", blob, filename);
        GM_xmlhttpRequest({
          method: "POST", url: SF_URL + "/api/complaint-details/import",
          headers: { "X-Upload-Token": SF_TOKEN },
          data: fd, timeout: 90000,
          onload: (r) => { console.log("[430D] SF", r.status, (r.responseText || "").slice(0, 200)); resolve(r.status >= 200 && r.status < 300); },
          onerror: (r) => { console.warn("[430D] SF error", r && r.status); resolve(false); },
          ontimeout: () => { console.warn("[430D] SF timeout"); resolve(false); },
        });
      } catch (e) { console.warn("[430D] upload exception", e); resolve(false); }
    });
  }
  // يرفع Blob (ملف xlsx كامل من الخادم) مباشرةً لمسار الاستيراد الذكى. يرجّع Promise<boolean>.
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

  // ضبط قيمة الحقل بشكل يفهمه أى framework (native setter + events)
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
    // أفضّل حقل نصّى/إيميل قبل الباسورد فى نفس الفورم، وإلا أى تخمين بالاسم/الـid
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

  function clickEl(el) {
    if (!el) return false;
    for (const t of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") { try { form.requestSubmit(el.type === "submit" ? el : undefined); } catch (e) {} }
    return true;
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
      try {
        const Ev = t.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ev(t, opts));
      } catch (e) { try { el.dispatchEvent(new MouseEvent(t.replace("pointer", "mouse"), opts)); } catch (e2) {} }
    }
    // النقر الأصلى — ضرورى لروابط التبويبات <a href="javascript:void(0)" onclick=...>
    try { if (typeof el.click === "function") el.click(); } catch (e) {}
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") { try { form.requestSubmit(el.type === "submit" ? el : undefined); } catch (e) {} }
    return true;
  }

  // مسار تقرير الـ Trial (Excel كامل بكل الأعمدة) + لينك فتحه من الكتالوج
  const XDO_PATH = "/FCC Prod/430D Trial القطاع-TEDATA - Details متابعة اعطال.xdo";
  const REPORT_URL = "https://we-oas.te.eg/analytics/saw.dll?bipublisherEntry&action=open&bippath=" + encodeURIComponent(XDO_PATH) + "&itemtype=.xdo";

  /* ================== التواريخ (MM-DD-YYYY زى الموقع) ================== */
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "-" + d.getFullYear();
  const NOW = new Date();
  const TO_STR = fmtDate(NOW);
  // from_date: لو اليوم ≤ 7 → يوم 25 من الشهر السابق؛ لو ≥ 8 → أول يوم فى الشهر الحالى
  const FROM_STR = fmtDate(
    NOW.getDate() <= 7
      ? new Date(NOW.getFullYear(), NOW.getMonth() - 1, 25)
      : new Date(NOW.getFullYear(), NOW.getMonth(), 1)
  );

  /* ================== جلب Excel مباشرة من xmlpserver (كل الأعمدة) ================== */
  // رابط تصدير تبويب من التقرير: _xpt = رقم التبويب (0=التفاصيل، 1=تفاصيل المتبقى) — من الـ Network.
  function exportUrl(tab) {
    const base = "https://we-oas.te.eg/xmlpserver" + XDO_PATH.split("/").map(encodeURIComponent).join("/");
    return base + "?_xpf=&_xpt=" + tab + "&_xmode=2&_xdo=" + encodeURIComponent(XDO_PATH) +
      "&from_date=" + encodeURIComponent(FROM_STR) + "&to_date=" + encodeURIComponent(TO_STR);
  }
  // يجلب الملف كـ arraybuffer ويتحقق إنه xlsx فعلاً (يبدأ بـ PK). يرجّع Blob أو null.
  function fetchXlsx(url) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET", url, responseType: "arraybuffer", timeout: 120000,
        onload: (r) => {
          const buf = r.response; const u8 = buf ? new Uint8Array(buf) : new Uint8Array();
          const isXlsx = u8[0] === 0x50 && u8[1] === 0x4B;   // PK = بداية ملف xlsx (zip)
          console.log("[430D] fetch", r.status, "bytes", u8.length, "xlsx?", isXlsx, "head", [...u8.slice(0, 4)]);
          if (isXlsx) return resolve(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
          try { console.log("[430D] رد مش xlsx:", new TextDecoder().decode(u8.slice(0, 400))); } catch (e) {}
          resolve(null);
        },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }
  // ينزّل Blob على الجهاز (للمراجعة قبل الرفع)
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
    setFlag(); // نويّنا نكمّل السيكوينس بعد الدخول
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

  /* ================== 2) صفحة Oracle Analytics (Home): فتح تقرير 430D من المفضلة مباشرة ================== */
  // النص الظاهر على الكارت مقصوص ("430D القطاع-TEDATA - ...") فبنعتمد على 430D + TEDATA وبدون Trial.
  function findReportCard() {
    const leaves = qAll("*").filter((e) => {
      if (e.children.length !== 0 || !visible(e)) return false;
      const t = (e.textContent || "") + " " + (e.getAttribute && (e.getAttribute("title") || e.getAttribute("aria-label") || ""));
      return /430D/i.test(t) && /TEDATA/i.test(t) && !/trial/i.test(t);
    });
    for (const leaf of leaves) {
      // اصعد لأقرب حاوية تحتوى أيضاً على إيميل المالك (= كارت التقرير كامل) ثم اضغطها
      let node = leaf;
      for (let k = 0; k < 7 && node; k++) {
        if (/@te\.eg|mohamed\.zaki/i.test(node.textContent || "")) return node;
        node = node.parentElement;
      }
      return leaf.closest("a,[role='button'],[role='link'],li,div") || leaf;
    }
    return null;
  }
  async function homeFlow() {
    // نفتح التقرير باللينك الدائم مباشرةً (أضمن من الضغط على الكارت). الفلاج شغّال فالسكربت هيكمّل فى صفحة التقرير.
    banner("📂 فتح التقرير باللينك المباشر…");
    location.href = REPORT_URL;
  }

  /* ================== 3) صفحة التقرير: التواريخ + Apply + تبويب المتبقى + Apply ================== */
  // يرجّع الخانة التى تلى اللابل (from_date/to_date) مباشرةً فى ترتيب الصفحة —
  // مش أى input فى الأب (اللى كان بيخلّى to_date ياخد نفس خانة from).
  function findLabeledInput(re) {
    for (const d of docsList()) {
      let lbl;
      try { lbl = [...d.querySelectorAll("*")].find((e) => e.children.length === 0 && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 20); } catch (e) {}
      if (!lbl) continue;
      let inputs = [];
      try { inputs = [...d.querySelectorAll("input")].filter((i) => visible(i) && i.type !== "hidden" && i.type !== "button" && i.type !== "submit" && i.type !== "checkbox" && i.type !== "radio"); } catch (e) {}
      // الخانات التى تأتى بعد اللابل فى ترتيب DOM → أقربها هى خانة هذا اللابل
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
  // كل جداول النتائج (فى كل الـ iframes: docframe1=تفاصيل / docframe2=متبقى …) — بدون اشتراط
  // visible() لأن iframe التبويب غير النشط ممكن يبقى بارتفاع 0 لكن جدوله متحمّل. نميّز بينهم لاحقاً
  // بمجموعة أرقام الشكاوى (complainSet). مرتّبة تنازلياً حسب عدد الصفوف.
  function allReportTables() {
    return qAll("table")
      .filter((t) => /التليفون|tel\s*no|complain\s*no/i.test(t.textContent || "") && t.querySelectorAll("tr").length > 2)
      .sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length);
  }
  function visibleReportTable() { return allReportTables()[0] || null; }
  // يقرأ صفوف الجدول الظاهر → Array من Arrays (أول صف = العناوين)
  function scrapeRows(table) {
    if (!table) return [];
    return [...table.querySelectorAll("tr")]
      .map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()))
      .filter((r) => r.length > 1 && r.some((c) => c));
  }
  const rowsSig = (rows) => rows.length + "|" + ((rows[1] || []).join("~"));
  // مجموعة أرقام الشكاوى (COMPLAIN NO) — علامة ثابتة للتمييز بين التفاصيل والمتبقى
  // (بنتجنّب المقارنة بكل الخلايا لأن عمود «Time until now» بيتغيّر كل لحظة).
  const complainSet = (rows) => {
    if (!rows || rows.length < 2) return "";
    const hdr = (rows[0] || []).map((x) => String(x).toLowerCase());
    let ci = hdr.findIndex((x) => /complain\s*no|رقم\s*الشكوى/.test(x));
    if (ci < 0) ci = 2; // عمود COMPLAIN NO غالباً الثالث
    return rows.slice(1).map((r) => String(r[ci] || "").replace(/\D/g, "")).filter(Boolean).sort().join(",");
  };
  // بناء ملف Excel (SpreadsheetML 2003 XML) بعدة شيتات — بدون مكتبات خارجية
  const xmlEsc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function buildXls(sheets) {
    let x = '<?xml version="1.0"?>\r\n<?mso-application progid="Excel.Sheet"?>\r\n';
    x += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\r\n';
    for (const s of sheets) {
      const nm = (s.name || "Sheet").replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31);
      x += '<Worksheet ss:Name="' + xmlEsc(nm) + '"><Table>\r\n';
      for (const r of (s.rows || [])) {
        x += "<Row>" + r.map((c) => '<Cell><Data ss:Type="String">' + xmlEsc(c) + "</Data></Cell>").join("") + "</Row>\r\n";
      }
      x += "</Table></Worksheet>\r\n";
    }
    x += "</Workbook>";
    return x;
  }
  function downloadFile(content, name, mime) {
    try {
      const blob = new Blob(["﻿" + content], { type: (mime || "text/plain") + ";charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name;
      (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    } catch (e) { console.warn("download err", e); return false; }
  }
  // يضغط تبويب بالاسم بشكل موثوق (يستهدف الرابط/الخلية القابلة للنقر)
  // ضغط شامل جداً — تسلسل أحداث كامل + النقر الأصلى (لتبويبات OBIEE العنيدة)
  function fireClick(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    const o = { bubbles: true, cancelable: true, view: window };
    for (const t of ["pointerover", "mouseover", "mouseenter", "pointerdown", "mousedown", "focus", "pointerup", "mouseup", "click"]) {
      try {
        const E = t.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : (t === "focus" ? FocusEvent : MouseEvent);
        el.dispatchEvent(new E(t, o));
      } catch (e) { try { el.dispatchEvent(new MouseEvent(t.replace("pointer", "mouse"), o)); } catch (e2) {} }
    }
    try { if (typeof el.click === "function") el.click(); } catch (e) {}
  }
  const tagRank = (el) => (el.tagName === "A" ? 0 : el.tagName === "TD" ? 1 : 2);
  async function clickTabByText(re) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cands = qAll("a,td,span,div,li").filter((e) => visible(e) && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 30);
      cands.sort((x, y) => tagRank(x) - tagRank(y)); // الروابط أولاً
      const el = cands[0];
      if (el) {
        const clickable = el.closest("a") || el.closest("td") || el;
        console.log("[430D] ضغط تبويب على:", clickable.tagName, JSON.stringify((clickable.textContent || "").trim().slice(0, 30)), clickable.outerHTML && clickable.outerHTML.slice(0, 160));
        fireClick(clickable);
        if (clickable !== el) fireClick(el);
        await sleep(1800);
        return true;
      }
      await sleep(1200);
    }
    return false;
  }
  // يجلب الملفين (التفاصيل _xpt=0 + المتبقى _xpt=1) كاملين من xmlpserver، ينزّلهم للمراجعة،
  // وبعد تأكيدك يرفعهم للموقع. لا يعتمد على سحب الجريد إطلاقاً — كل الأعمدة موجودة.
  async function reportFlow() {
    banner("⬇️ تحميل ملفات Excel كاملة (" + FROM_STR + " → " + TO_STR + ")…");
    const jobs = [{ tab: 0, label: "التفاصيل" }, { tab: 1, label: "المتبقى" }];
    const got = [];
    for (const j of jobs) {
      banner("⬇️ " + j.label + "…");
      const blob = await fetchXlsx(exportUrl(j.tab));
      if (blob) {
        const name = "430D_" + (j.tab === 0 ? "details" : "remaining") + "_" + FROM_STR + "_" + TO_STR + ".xlsx";
        saveBlob(blob, name);                 // نزّله على الجهاز للمراجعة
        got.push({ ...j, blob, name, kb: Math.round(blob.size / 1024) });
      } else {
        banner("⚠️ فشل تحميل " + j.label + " — راجع الكونسول [430D]", "#ef6c00");
      }
    }
    if (!got.length) { banner("❌ لم يتم تحميل أى ملف — شوف الكونسول", "#c62828"); clearFlag(); return; }
    // مراجعة قبل الرفع
    const summary = got.map((g) => g.label + " (" + g.kb + "KB)").join(" + ");
    banner("📥 اتحمّل: " + summary + " — راجع الملفات", "#2e7d32");
    const proceed = confirm("اتحمّل على جهازك:\n" + got.map((g) => "• " + g.name + " (" + g.kb + " KB)").join("\n") + "\n\nراجع البيانات. أرفعهم للموقع دلوقتى؟");
    if (!proceed) { banner("⏸️ اتلغى الرفع — الملفات اتحمّلت للمراجعة بس.", "#607d8b"); clearFlag(); return; }
    // الرفع للموقع
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
  const path = location.pathname + location.search;
  const isLogin  = /bi-security-login/i.test(path);
  const isReport = /saw\.dll|\/analytics\//i.test(path);
  const isHome   = !isReport && (/\/dv\//i.test(path) || /home\.jsp/i.test(path));

  // نص الصفحة (عبر كل الـ iframes) — للتمييز بين تقارير we-oas (الـ URL بيتشال منه الـ bippath)
  function pageText() { let s = ""; for (const d of docsList()) { try { s += " " + (d.body ? d.body.innerText : ""); } catch (e) {} } return s; }
  // تقرير 430D = فيه from_date/to_date. العلامة المميّزة لـ 131 هى P_CABINET_NO فقط
  // (ملاحظة: P_CENTRAL_NAME موجودة فى تقرير 430D أيضاً فلا تصلح للتمييز).
  async function is430ReportPage() {
    return await waitFor(() => {
      const t = pageText();
      if (/P_CABINET_NO|نحاسى?/i.test(t)) return false; // ده تقرير 131 مش بتاعنا
      if (/from_?date/i.test(t) && /to_?date/i.test(t)) return true;
      return null; // لسه بيحمّل
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
    // اتأكد من المحتوى إنه تقرير 430D (مش 131) قبل ما نظهر أى حاجة أو نشتغل
    is430ReportPage().then((ok) => {
      if (!ok) return; // مش تقرير 430D — سيبها للسكربت التانى
      ui();
      if (flagOn()) sleep(800).then(() => kickoff(false)).catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
    }).catch(() => {});
  }

  // تصدير يدوى من الكونسول لو حبيت تعيد التنزيل: OAS_export()
  window.OAS_export = () => { const r = scrapeRows(visibleReportTable()); if (r.length) { downloadFile(buildXls([{ name: "بيانات", rows: r }]), "430D_export_" + FROM_STR + "_" + TO_STR + ".xls", "application/vnd.ms-excel"); console.log("✅ اتحمّل"); } else console.warn("مفيش جدول ظاهر"); };
})();
