// ==UserScript==
// @name         WE OAS BI — دخول تلقائى + تقرير 430D
// @namespace    service-flow.we-oas.login
// @description  يسجّل الدخول على we-oas.te.eg BI، يفتح تقرير «القطاع-TEDATA - Details متابعة اعطال»، يضبط from_date/to_date، Apply، يسحب «التفاصيل» ثم يفتح تبويب «تفاصيل المتبقى» (بانتظار قوى بدون Apply تانى)، ويرفع الشيتين لموقع Service-Flow تلقائياً (+ نسخة على الجهاز).
// @version      1.3.2
// @match        *://we-oas.te.eg/*
// @grant        GM_xmlhttpRequest
// @connect      service-flow-menoskar42.replit.app
// @connect      replit.app
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

  // لينك التقرير الدائم (مسار الكتالوج — لا يحتوى توكن جلسة)
  const REPORT_URL = "https://we-oas.te.eg/analytics/saw.dll?bipublisherEntry&action=open&bippath=%2FFCC%20Prod%2F430D%20%D8%A7%D9%84%D9%82%D8%B7%D8%A7%D8%B9-TEDATA%20-%20Details%20%D9%85%D8%AA%D8%A7%D8%A8%D8%B9%D8%A9%20%D8%A7%D8%B9%D8%B7%D8%A7%D9%84.xdo&itemtype=.xdo";

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
  // كل جداول النتائج الظاهرة (فيها أعمدة التليفون/الشكوى) مرتبة تنازلياً حسب عدد الصفوف
  function allReportTables() {
    return qAll("table")
      .filter((t) => visible(t) && /التليفون|tel\s*no|complain\s*no/i.test(t.textContent || "") && t.querySelectorAll("tr").length > 1)
      .sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length);
  }
  // أكبر جدول ظاهر (للتفاصيل — أول Apply مفيش غيره)
  function visibleReportTable() { return allReportTables()[0] || null; }
  // يقرأ صفوف الجدول الظاهر → Array من Arrays (أول صف = العناوين)
  function scrapeRows(table) {
    if (!table) return [];
    return [...table.querySelectorAll("tr")]
      .map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()))
      .filter((r) => r.length > 1 && r.some((c) => c));
  }
  const rowsSig = (rows) => rows.length + "|" + ((rows[1] || []).join("~"));
  // بصمة محتوى كامل (كل الخلايا) — للتمييز الأكيد بين جدول التفاصيل وجدول المتبقى
  const contentSig = (rows) => rows.length + "::" + rows.map((r) => r.join("~")).join("||");
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
  async function reportFlow() {
    banner("📅 ضبط التواريخ (" + FROM_STR + " → " + TO_STR + ")…");
    const apply = await waitFor(() => findBtn(/^\s*apply\s*$/i), 40000);
    if (!apply) { banner("❌ لم تُحمّل صفحة التقرير (لا يوجد Apply)", "#c62828"); return; }
    closeDatePopup();
    const fromI = findLabeledInput(/from_?date/i);
    const toI = findLabeledInput(/to_?date/i);
    // حاجز صارم: ده مش تقرير 430D (مفيش from/to date) → لا تعمل حاجة ولا تنزّل أى ملف
    if (!fromI || !toI) { banner("⏹️ مش تقرير 430D (مفيش from/to date) — تجاهل.", "#607d8b"); clearFlag(); return; }
    setValue(fromI, FROM_STR);
    setValue(toI, TO_STR);
    closeDatePopup();
    await sleep(500);
    // ===== 1) تبويب التفاصيل =====
    banner("▶️ Apply (التفاصيل) — استنى النتائج…");
    clickEl(findBtn(/^\s*apply\s*$/i) || apply);
    const detailsTable = await waitFor(() => { const tb = visibleReportTable(); return tb && tb.querySelectorAll("tr").length > 2 ? tb : null; }, 35000);
    await sleep(1500);
    const detailsRows = scrapeRows(detailsTable || visibleReportTable());
    const detailsFull = contentSig(detailsRows);   // بصمة كل خلايا التفاصيل — للاستبعاد الأكيد
    banner("✔️ التفاصيل: " + Math.max(0, detailsRows.length - 1) + " صف — للمتبقى…", "#2e7d32");
    // ===== 2) تبويب «تفاصيل المتبقى» =====
    // تبويب المتبقى بيفضل فاضى لحد ما نضغط Apply وهو مفتوح. المشكلة إن Apply بيعيد توليد
    // التقرير ويرجّع التبويب النشط لـ«التفاصيل» → فلازم بعد الـ Apply نفتح تبويب المتبقى **تانى**
    // ثم نستنّى لحد ما يظهر جدول بياناته مختلفة عن التفاصيل. بنكرّر المحاولة لو مالحقش يحمّل.
    const MOT_RE = /تفاصيل\s*(ال)?م[بت]?قى|متبقى|مبقى/;
    // يدوّر على أول جدول ظاهر محتواه **مختلف تماماً** عن التفاصيل (مش أكبر جدول) = جدول المتبقى.
    const grabMot = (ms) => waitFor(() => {
      for (const tb of allReportTables()) {
        if (tb.querySelectorAll("tr").length <= 2) continue;
        const r = scrapeRows(tb);
        if (contentSig(r) !== detailsFull) return tb;   // جدول مش هو التفاصيل → المتبقى
      }
      return null;
    }, ms);
    let motTable = null;
    for (let attempt = 0; attempt < 3 && !motTable; attempt++) {
      banner("📑 «تفاصيل المتبقى» — محاولة " + (attempt + 1) + "…");
      await clickTabByText(MOT_RE);                     // ① افتح تبويب المتبقى
      await sleep(1500);
      clickEl(findBtn(/^\s*apply\s*$/i) || apply);      // ② Apply عشان بيانات المتبقى تحمّل
      await sleep(4500);                                // ③ استنى إعادة التوليد
      await clickTabByText(MOT_RE);                     // ④ Apply رجّع التبويب للتفاصيل → افتح المتبقى تانى
      await sleep(1500);
      motTable = await grabMot(15000);                  // ⑤ استنى جدول مختلف عن التفاصيل
    }
    // تشخيص لو لسه فاضى: اطبع كل الجداول الظاهرة (عددها/صفوفها/أول صف)
    if (!motTable) {
      try {
        const diag = allReportTables().map((t, i) => { const r = scrapeRows(t); return "#" + i + " صفوف=" + r.length + " عناوين=" + JSON.stringify((r[0] || []).slice(0, 5)) + " أول=" + JSON.stringify((r[1] || []).slice(0, 5)); });
        console.log("[430D] الجداول الظاهرة عند فشل المتبقى:\n" + diag.join("\n"));
      } catch (e) {}
    }
    await sleep(1000);
    const motRows = motTable ? scrapeRows(motTable) : [];

    // ===== 3) بناء ملف بشيتين ثم الرفع للموقع (+ نسخة على الجهاز) =====
    const sheets = [];
    if (detailsRows.length) sheets.push({ name: "التفاصيل", rows: detailsRows });
    if (motRows.length) sheets.push({ name: "تفاصيل متبقى", rows: motRows });
    if (!sheets.length) { banner("⚠️ لم تظهر نتائج لتصديرها", "#ef6c00"); clearFlag(); return; }
    const fileName = "430D_" + FROM_STR + "_" + TO_STR + ".xls";
    const xml = buildXls(sheets);
    downloadFile(xml, fileName, "application/vnd.ms-excel");   // نسخة احتياطية على الجهاز
    const nD = Math.max(0, detailsRows.length - 1), nM = Math.max(0, motRows.length - 1);
    banner("📤 رفع للموقع… التفاصيل (" + nD + ") + المتبقى (" + nM + ")");
    const ok = await uploadToSF(xml, fileName);
    if (ok) banner("✅ اتحدّث الموقع: تفاصيل " + nD + " + متبقى " + nM + ".", "#2e7d32");
    else banner("⚠️ الملف اتحمّل بس الرفع للموقع فشل — راجع الكونسول.", "#ef6c00");
    if (detailsRows.length && !motRows.length) banner("ℹ️ التفاصيل فقط — المتبقى لسه فاضى/مش محمّل.", "#ef6c00");
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
