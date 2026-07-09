// ==UserScript==
// @name         WE OAS BI — تقرير 131 أرقام التليفونات على كابينة
// @namespace    service-flow.we-oas.131
// @description  يسجّل الدخول على we-oas.te.eg، يفتح تقرير «131 ارقام التليفونات على كابينة»، يختار P_CENTRAL_NAME=ديروط و P_CABINET_NO=1-1، Apply، ثم ينزّل Excel واحد بثلاث شيتات: نحاسي + فيبر + دوائر المعلومات. لا يرفع أى بيانات للموقع.
// @version      1.0.5
// @match        *://we-oas.te.eg/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mena.haleem@te.eg";
  const PASS = "Mon_oskar352";
  const CENTRAL = "ديروط";     // قيمة P_CENTRAL_NAME
  const CABINET = "1-1";        // قيمة P_CABINET_NO
  // التبويبات المطلوبة بالترتيب (نحاسي هو الافتراضى)
  // headRe = عمود مميّز فى هيدر جدول التبويب عشان نلقط الجدول الصح (مش أكبر جدول ظاهر)
  const TABS = [
    { name: "نحاسي", re: /^\s*نحاسى?\s*$/, headRe: /line\s*eq\s*no|mdf\s*ex\s*side|رقم\s*الكاب/i },
    { name: "فيبر", re: /^\s*فيبر\s*$/, headRe: /fiber|odu\s*no|idu\s*no/i },
    { name: "دوائر المعلومات", re: /دوائر\s*المعلومات/, headRe: /circuit\s*no/i },
  ];

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

  /* ================== أدوات عامة + iframes ================== */
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

  /* ================== التصدير (Excel بعدة شيتات) ================== */
  function visibleReportTable() {
    // أكبر جدول ظاهر فيه أعمدة بيانات التقرير (نحاسي/فيبر/دوائر)
    const tables = qAll("table").filter((t) => visible(t) && /tel\s*no|السنترال|رقم\s*الكاب|المركز|dp\s*(no|terminal)|onu|pon|دائرة|circuit/i.test(t.textContent || ""));
    return tables.sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length)[0] || null;
  }
  // جدول تبويب محدّد بالاعتماد على عمود مميّز فى الهيدر (بدل «أكبر جدول ظاهر»)
  function tableByHeader(headRe) {
    const tables = qAll("table").filter((t) => visible(t) && headRe.test(t.textContent || ""));
    return tables.sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length)[0] || null;
  }
  function scrapeRows(table) {
    if (!table) return [];
    return [...table.querySelectorAll("tr")]
      .map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()))
      .filter((r) => r.length > 1 && r.some((c) => c));
  }
  const rowsSig = (rows) => rows.length + "|" + ((rows[1] || []).join("~")) + "|" + ((rows[0] || []).join("~"));
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

  /* ================== واجهة ================== */
  let bar, btnStart;
  function ui() {
    if (bar) return;
    bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:7px 12px;font:bold 13px Arial;color:#fff;background:#00695c;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    bar.textContent = "⚙️ WE OAS — 131 كابينة";
    btnStart = document.createElement("button");
    btnStart.textContent = "▶️ ابدأ تقرير 131";
    btnStart.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:12px 18px;border:0;border-radius:10px;background:#00695c;color:#fff;font:bold 14px Arial;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45);direction:rtl";
    btnStart.onclick = () => { btnStart.disabled = true; kickoff(true).catch((e) => banner("❌ " + (e && e.message || e), "#c62828")); };
    (document.body || document.documentElement).appendChild(bar);
    (document.body || document.documentElement).appendChild(btnStart);
  }
  function banner(msg, color) { ui(); bar.style.background = color || "#00695c"; bar.textContent = msg; console.log("[131]", msg); }

  /* ================== تسجيل الدخول ================== */
  let loggedTried = false;
  async function autoLogin() {
    if (loggedTried) return; loggedTried = true;
    const pass = await waitFor(() => { const p = document.querySelector("input[type='password']"); return p && visible(p) ? p : null; }, 20000);
    if (!pass) return;
    const user = findUserField(pass);
    if (user) setValue(user, USER);
    setValue(pass, PASS);
    await sleep(400);
    const btn = findSignInBtn();
    if (btn) fireClick(btn);
    else pass.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true }));
  }

  /* ================== البرومبت: خانة نصية + دروب ليست ================== */
  function findLabeledInput(re) {
    for (const d of docsList()) {
      let lbl;
      try { lbl = [...d.querySelectorAll("*")].find((e) => e.children.length === 0 && re.test((e.textContent || "").trim())); } catch (e) {}
      if (!lbl) continue;
      let inputs = [];
      try { inputs = [...d.querySelectorAll("input")].filter((i) => visible(i) && i.type !== "hidden" && i.type !== "button" && i.type !== "submit" && i.type !== "checkbox" && i.type !== "radio"); } catch (e) {}
      const following = inputs.filter((i) => lbl.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (following.length) return following[0];
      if (inputs.length) return inputs[0];
    }
    return null;
  }
  // اختيار قيمة من دروب ليست البرومبت (native select أو دروب OBIEE منبثق)
  async function selectPromptValue(labelRe, valueRe) {
    // 1) native <select>
    for (const sel of qAll("select")) {
      if (!visible(sel)) continue;
      let opt = [...sel.options].find((o) => valueRe.test((o.textContent || "").trim()) && (o.textContent || "").trim().length < 30);
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); sel.dispatchEvent(new Event("input", { bubbles: true })); return true; }
    }
    // 2) دروب OBIEE: افتح البوكس اللى بعد اللابل ثم اختر العنصر من القائمة
    const lbl = qAll("*").find((e) => e.children.length === 0 && labelRe.test((e.textContent || "").trim()));
    let box = null;
    if (lbl) {
      const cand = qAll("a,div,span,td,button").filter((el) => visible(el) && (lbl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      box = cand.find((el) => /All|dropdown|combo|selectonemenu|ui-|arrow/i.test((el.className || "") + " " + (el.textContent || ""))) || cand[0] || null;
    }
    if (box) { fireClick(box); await sleep(1200); }
    const item = await waitFor(() => {
      const cands = qAll("a,li,option,td,div,span").filter((el) => visible(el) && valueRe.test((el.textContent || "").trim()) && (el.textContent || "").trim().length < 25);
      cands.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length); // الأقرب للاسم بالظبط
      return cands[0] || null;
    }, 8000);
    if (item) { fireClick(item.closest("a,li,option,td") || item); return true; }
    return false;
  }

  /* ================== ضغط تبويب ================== */
  async function clickTabByText(re) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cands = qAll("a,td,span,div,li").filter((e) => visible(e) && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 30);
      cands.sort((x, y) => (x.tagName === "A" ? 0 : x.tagName === "TD" ? 1 : 2) - (y.tagName === "A" ? 0 : y.tagName === "TD" ? 1 : 2));
      const el = cands[0];
      if (el) {
        const clickable = el.closest("a") || el.closest("td") || el;
        console.log("[131] ضغط تبويب على:", clickable.tagName, JSON.stringify((clickable.textContent || "").trim().slice(0, 20)));
        fireClick(clickable);
        if (clickable !== el) fireClick(el);
        await sleep(1800);
        return true;
      }
      await sleep(1000);
    }
    return false;
  }

  /* ================== التشغيل الرئيسى ================== */
  async function reportFlow() {
    banner("⚙️ ضبط البرومبت (ديروط / 1-1)…");
    const apply = await waitFor(() => findBtn(/^\s*apply\s*$/i), 40000);
    if (!apply) { banner("❌ لم تُحمّل صفحة التقرير (لا يوجد Apply)", "#c62828"); return; }
    // حاجز صارم: لازم يكون تقرير 131 (العلامة المميّزة = P_CABINET_NO، لأن P_CENTRAL_NAME موجودة فى 430D كمان)
    if (!/P_CABINET_NO/i.test(pageText())) { banner("⏹️ مش تقرير 131 — تجاهل.", "#607d8b"); return; }
    // نكتفى بكتابة رقم الكابينة فقط (P_CENTRAL_NAME = All) — أسرع وبدون مشاكل الدروب ليست
    const cab = findLabeledInput(/P_CABINET_NO/i);
    if (cab) setValue(cab, CABINET); else banner("⚠️ لم أجد خانة P_CABINET_NO", "#ef6c00");
    await sleep(400);

    const sheets = [];
    for (let i = 0; i < TABS.length; i++) {
      const tab = TABS[i];
      if (i > 0) {
        banner("↪️ تبويب " + tab.name + "…");
        await clickTabByText(tab.re);
        await sleep(3500);
      }
      banner("▶️ Apply (" + tab.name + ") — استنى النتائج…");
      fireClick(findBtn(/^\s*apply\s*$/i) || apply);
      // استنى جدول التبويب (بعموده المميّز) يظهر، ثم استنى تحميل البيانات
      await waitFor(() => tableByHeader(tab.headRe), 30000);
      await sleep(5000);
      let tb = tableByHeader(tab.headRe);
      let rows = scrapeRows(tb);
      // لو لسه هيدر بس (ممكن البيانات لسه بتحمّل) استنى شوية وأعد القراءة
      if (rows.length <= 1) { await sleep(4000); tb = tableByHeader(tab.headRe); rows = scrapeRows(tb); }
      banner("✔️ " + tab.name + ": " + Math.max(0, rows.length - 1) + " صف", "#2e7d32");
      sheets.push({ name: tab.name, rows: rows.length ? rows : [["لا توجد بيانات"]] });
    }
    downloadFile(buildXls(sheets), "131_cabinet_" + CABINET + ".xls", "application/vnd.ms-excel");
    banner("📥 اتحمّل ملف Excel (نحاسي/فيبر/دوائر المعلومات).", "#2e7d32");
  }

  /* ================== الراوتر ==================
     ملاحظة: OBIEE بيشيل الـ bippath من الـ URL، فبنميّز التقرير من محتوى الصفحة مش الـ URL. */
  const url = location.href;
  const isLogin = /bi-security-login/i.test(url);
  const isSaw = /saw\.dll|\/analytics\//i.test(url);
  function pageText() { let s = ""; for (const d of docsList()) { try { s += " " + (d.body ? d.body.innerText : ""); } catch (e) {} } return s; }
  // تقرير 131 = فيه P_CABINET_NO/P_CENTRAL_NAME أو تبويبات نحاسى+دوائر المعلومات، ومش فيه from_date (بتاع 430D)
  async function is131ReportPage() {
    return await waitFor(() => {
      const t = pageText();
      if (/from_?date/i.test(t) && /to_?date/i.test(t)) return false; // ده تقرير 430D
      if (/P_CABINET_NO/i.test(t) || (/نحاسى?/.test(t) && /دوائر\s*المعلومات/.test(t))) return true;
      return null; // لسه بيحمّل
    }, 20000);
  }

  let started = false;
  async function kickoff(manual) {
    if (started) return; started = true;
    await reportFlow();
  }

  if (isLogin) {
    autoLogin();
  } else if (isSaw) {
    is131ReportPage().then((ok) => {
      if (!ok) return; // مش تقرير 131 — سيبها لسكربت 430D
      ui();
      sleep(800).then(() => kickoff(false)).catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
    }).catch(() => {});
  }

  // تصدير يدوى للتبويب الظاهر: WEOAS131_export()
  window.WEOAS131_export = () => { const r = scrapeRows(visibleReportTable()); if (r.length) { downloadFile(buildXls([{ name: "بيانات", rows: r }]), "131_export.xls", "application/vnd.ms-excel"); console.log("✅ اتحمّل"); } else console.warn("مفيش جدول ظاهر"); };
})();
