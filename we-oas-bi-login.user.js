// ==UserScript==
// @name         WE OAS BI — دخول تلقائى + تقرير 430D
// @namespace    service-flow.we-oas.login
// @description  يسجّل الدخول على we-oas.te.eg BI، ثم على Oracle Analytics: يبحث 430d، يفتح تقرير «القطاع-TEDATA - Details متابعة اعطال»، يضبط from_date=يوم 25 من الشهر السابق و to_date=اليوم، Apply، ثم تبويب «تفاصيل المتبقى» ثم Apply. لا يرفع أى بيانات للموقع.
// @version      1.2.1
// @match        *://we-oas.te.eg/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mena.haleem@te.eg";
  const PASS = "Mon_oskar352";

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
  // جدول النتائج الظاهر فقط (تبويب النشط) — مش الجداول المخفية للتبويبات التانية
  function visibleReportTable() {
    const tables = qAll("table").filter((t) => visible(t) && /التليفون|tel\s*no|complain\s*no/i.test(t.textContent || ""));
    return tables.sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length)[0] || null;
  }
  // يقرأ صفوف الجدول الظاهر → Array من Arrays (أول صف = العناوين)
  function scrapeRows(table) {
    if (!table) return [];
    return [...table.querySelectorAll("tr")]
      .map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()))
      .filter((r) => r.length > 1 && r.some((c) => c));
  }
  const rowsSig = (rows) => rows.length + "|" + ((rows[1] || []).join("~"));
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
    if (fromI) setValue(fromI, FROM_STR); else banner("⚠️ لم أجد خانة from_date", "#ef6c00");
    if (toI) setValue(toI, TO_STR); else banner("⚠️ لم أجد خانة to_date", "#ef6c00");
    closeDatePopup();
    await sleep(500);
    // ===== 1) تبويب التفاصيل =====
    banner("▶️ Apply (التفاصيل) — استنى النتائج…");
    clickEl(findBtn(/^\s*apply\s*$/i) || apply);
    const detailsTable = await waitFor(() => { const tb = visibleReportTable(); return tb && tb.querySelectorAll("tr").length > 2 ? tb : null; }, 35000);
    await sleep(1500);
    const detailsRows = scrapeRows(visibleReportTable());
    const detailsSig = rowsSig(detailsRows);
    banner("✔️ التفاصيل: " + Math.max(0, detailsRows.length - 1) + " صف — للمتبقى…", "#2e7d32");
    // ===== 2) تبويب تفاصيل المتبقى =====
    const okTab = await clickTabByText(/تفاصيل\s*(ال)?م[بت]?قى|متبقى|مبقى/);
    if (!okTab) banner("⚠️ لم أجد تبويب «تفاصيل المتبقى»", "#ef6c00");
    await sleep(4000); // انتظار إعادة رسم صفحة المتبقى
    banner("▶️ Apply (المتبقى) — استنى النتائج…");
    clickEl(findBtn(/^\s*apply\s*$/i) || apply);
    // استنى جدول تختلف بياناته عن التفاصيل (= تبويب المتبقى فعلاً حمّل)
    const motTable = await waitFor(() => {
      const tb = visibleReportTable();
      if (!tb || tb.querySelectorAll("tr").length <= 2) return null;
      const r = scrapeRows(tb);
      return rowsSig(r) !== detailsSig ? tb : null;
    }, 40000);
    await sleep(1500);
    const motRows = motTable ? scrapeRows(motTable) : [];
    // ===== 3) ملف Excel واحد بشيتين =====
    const sheets = [];
    if (detailsRows.length) sheets.push({ name: "التفاصيل", rows: detailsRows });
    if (motRows.length) sheets.push({ name: "تفاصيل المتبقى", rows: motRows });
    if (sheets.length) {
      downloadFile(buildXls(sheets), "430D_" + FROM_STR + "_" + TO_STR + ".xls", "application/vnd.ms-excel");
      banner("📥 اتحمّل ملف Excel: التفاصيل (" + Math.max(0, detailsRows.length - 1) + ") + المتبقى (" + Math.max(0, motRows.length - 1) + ").", "#2e7d32");
    } else banner("⚠️ لم تظهر نتائج لتصديرها", "#ef6c00");
    if (detailsRows.length && !motRows.length) banner("ℹ️ التفاصيل فقط اتصدّرت — المتبقى لم يحمّل/فاضى.", "#ef6c00");
    clearFlag();
  }

  /* ================== الراوتر ================== */
  const path = location.pathname + location.search;
  const isLogin  = /bi-security-login/i.test(path);
  const isReport = /saw\.dll|\/analytics\//i.test(path);
  const isHome   = !isReport && (/\/dv\//i.test(path) || /home\.jsp/i.test(path));

  const is430Report = /430D/i.test(location.href); // تقرير 430D تحديداً (مش تقارير we-oas تانية)
  let started = false;
  async function kickoff(manual) {
    if (started) return; started = true;
    if (isReport) { if (!manual && !is430Report) return; await reportFlow(); } // ماتشتغلش على تقارير we-oas التانية
    else if (isHome) await homeFlow();
  }

  if (isLogin) {
    autoLogin();
  } else {
    const mine = isHome || is430Report; // اعرض الواجهة فقط على صفحات 430D
    if (mine) ui();
    // شغّل تلقائياً لو جايين من الدخول (الفلاج شغّال)، بعد ما الـ SPA يجهز
    if (mine && flagOn()) waitFor(() => document.body, 10000).then(() => sleep(1800)).then(() => kickoff(false)).catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
  }

  // تصدير يدوى من الكونسول لو حبيت تعيد التنزيل: OAS_export()
  window.OAS_export = () => { const r = scrapeRows(visibleReportTable()); if (r.length) { downloadFile(buildXls([{ name: "بيانات", rows: r }]), "430D_export_" + FROM_STR + "_" + TO_STR + ".xls", "application/vnd.ms-excel"); console.log("✅ اتحمّل"); } else console.warn("مفيش جدول ظاهر"); };
})();
