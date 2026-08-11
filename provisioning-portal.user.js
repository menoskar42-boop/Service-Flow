// ==UserScript==
// @name         Provisioning Portal → Service-Flow (تحديث البورتات + غيّر البورت MSAN)
// @namespace    service-flow.provisioning
// @description  سكربت واحد لموقع Provisioning Portal (WE) — فيه ثلاث تدفّقات مستقلة تماماً بماركرات مختلفة لمنع أى تعارض: (1) sf_ports = تحديث ملف البورتات (Get MSAN Data لكل أكواد الأمسان المخزّنة فى Service-Flow). (2) sf_msan = غيّر البورت (MSAN Replacement) لرقم واحد — يملأ Old/New Cabin Code ويحقن ملف CSV ويضغط Submit، ثم يراقب 30 ثانية للتأكد إنه مرجعش للّوجين (نجح) قبل ما يقفل التاب (بدون متابعة تلقائية). (3) sf_pcheck = تحديث البورت (يدوى) — يفتح Search For My Requests مرة واحدة لرقم، يطابقه، ولو COMPLETED يجيب New Frame + New Msan ويحدّث بيان البورت فى Service-Flow. كل تدفّق فى نافذة باسم مستقل فالـ sessionStorage منفصل ومفيش تداخل.
// @version      1.5.9
// @match        *://provisioningportal.te.eg/provisioningPortal/*
// @connect      service-flow-menoskar42.replit.app
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  /* ================== تشغيل تلقائى: التقاط النيّة مبكّراً ==================
     البورتال (Angular) بيمسح ?sf_ports=1 / ?sf_msan=1 من الـ URL بمجرّد ما يعمل redirect لـ #/login،
     فلازم نلتقطهم عند document-start قبل ما يختفوا، ونحفظهم فى sessionStorage علشان يعيشوا عبر الـ
     redirect للّوجين وأى تنقّل داخلى. كل تدفّق ماركره مستقل — فالتدفّقان مايتعارضوش أبداً. */
  const AUTO_KEY = "sf_ports_auto";
  const MSAN_KEY = "sf_msan_replace";
  const PCHECK_KEY = "sf_pcheck_data";
  try {
    if (/[?&#]sf_ports=1\b/.test(location.href)) sessionStorage.setItem(AUTO_KEY, "1");
  } catch (e) {}
  try {
    if (/[?&]sf_msan=1\b/.test(location.href)) {
      const p = new URL(location.href).searchParams;
      const data = {
        old: p.get("old") || "", new: p.get("new") || "", phone: p.get("phone") || "",
        area: p.get("area") || "88", pt: p.get("pt") || "SV", sp: p.get("sp") || "WE30",
      };
      sessionStorage.setItem(MSAN_KEY, JSON.stringify(data));
    }
  } catch (e) {}
  try {
    if (/[?&]sf_pcheck=1\b/.test(location.href)) {
      const p = new URL(location.href).searchParams;
      const data = { phone: p.get("phone") || "", old: p.get("old") || "", new: p.get("new") || "", pt: p.get("pt") || "" };
      sessionStorage.setItem(PCHECK_KEY, JSON.stringify(data));
    }
  } catch (e) {}
  const AUTO = (() => { try { return sessionStorage.getItem(AUTO_KEY) === "1"; } catch (e) { return false; } })();
  const MSAN = (() => { try { return JSON.parse(sessionStorage.getItem(MSAN_KEY) || "null"); } catch (e) { return null; } })();
  const PCHECK = (() => { try { return JSON.parse(sessionStorage.getItem(PCHECK_KEY) || "null"); } catch (e) { return null; } })();

  /* ================== CONFIG ================== */
  const USER = "mena.haleem";
  const PASS = "Mon_oskar364";
  const SF_API_BASE = "https://service-flow-menoskar42.replit.app"; // دومين Service-Flow
  const SF_TOKEN = "sf-dzs-138-ingest-2026";                        // = DZS_INGEST_TOKEN فى السيرفر
  const GET_MSAN_HASH = "#/subscriber-management/get-msan-data";
  const MSAN_REPL_HASH = "#/subscriber-management/msan-replacement";
  const SEARCH_REQ_HASH = "#/search/search-for-my-requests"; // صفحة متابعة الطلبات
  const SEARCH_WAIT_MS = 45000;   // أقصى انتظار لظهور بيانات الأمسان بعد Search
  const BETWEEN_CABINS_MS = 1200; // راحة بسيطة بين كل أمسان والتالى

  /* ================== اعتراض الشبكة (fetch + XHR) لالتقاط صفوف الأمسان ================== */
  const captures = []; // [{ t, rows }]
  const looksLikeRow = (o) =>
    o && typeof o === "object" && !Array.isArray(o) &&
    Object.keys(o).some((k) => /phone|msisdn/i.test(k)) &&
    Object.keys(o).some((k) => /msan|frame|port|slot|shelf/i.test(k));
  function findRows(json) {
    const seen = new Set();
    const stack = [json];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
      seen.add(cur);
      if (Array.isArray(cur)) {
        if (cur.length && looksLikeRow(cur[0])) return cur;
        for (const v of cur) if (v && typeof v === "object") stack.push(v);
      } else {
        for (const k of Object.keys(cur)) { const v = cur[k]; if (v && typeof v === "object") stack.push(v); }
      }
    }
    return null;
  }
  function tryCapture(text) {
    if (!text || text.length < 20) return;
    let json; try { json = JSON.parse(text); } catch (e) { return; }
    const rows = findRows(json);
    if (rows && rows.length) { captures.push({ t: Date.now(), rows }); console.log("📡 التقطنا", rows.length, "صف أمسان"); }
  }
  const _fetch = window.fetch;
  window.fetch = function (...args) {
    return _fetch.apply(this, args).then((resp) => {
      try { resp.clone().text().then(tryCapture).catch(() => {}); } catch (e) {}
      return resp;
    });
  };
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__sf_url = u; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      try {
        const ct = (this.getResponseHeader("content-type") || "");
        if (/json|text/i.test(ct) || !ct) tryCapture(this.responseText);
      } catch (e) {}
    });
    return _send.apply(this, arguments);
  };

  /* ================== أدوات DOM / Angular ================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { try { return !!el && el.getClientRects().length > 0; } catch (e) { return false; } };
  const norm = (s) => (s || "").toLowerCase().replace(/[\s_]+/g, "");

  async function waitFor(fn, ms) {
    const end = Date.now() + (ms || 15000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(200); }
    return null;
  }
  // ضبط قيمة input بشكل يفهمه Angular (native setter + input event)
  function setNgValue(input, value) {
    try { input.focus(); } catch (e) {}
    try {
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(input, value);
    } catch (e) { input.value = value; }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function findButtonByText(re) {
    const els = [...document.querySelectorAll("button, input[type='button'], input[type='submit'], a")];
    return els.find((b) => visible(b) && re.test(((b.textContent || b.value || "").trim())));
  }
  function findSearchButton(input) {
    const re = /^\s*search\s*$|بحث/i;
    let node = input;
    for (let d = 0; d < 7 && node; d++) {
      const btns = [...node.querySelectorAll("button, input[type='submit'], input[type='button']")]
        .filter((b) => visible(b) && re.test((b.textContent || b.value || "")));
      if (btns.length) return btns[btns.length - 1];
      node = node.parentElement;
    }
    return [...document.querySelectorAll("button, input[type='submit']")]
      .find((b) => visible(b) && re.test((b.textContent || b.value || "")) && !b.closest("nav,aside,.sidebar,.side-menu,.menu,ul")) || null;
  }
  function clickEl(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    // التسلسل قبل الضغطة (بعض مكوّنات Angular بتستنى pointer/mouse الأول)
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    }
    // ضغطة حقيقية واحدة — أقرب لسلوك المستخدم من MouseEvent الصناعى، ومابتتكررش.
    // (الرابط href="javascript:void(0)" فمفيش تنقّل، Angular هو اللى بيمسك الضغطة.)
    if (typeof el.click === "function") { try { el.click(); } catch (e) {} }
    else { try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch (e) {} }
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") { try { form.requestSubmit(el.type === "submit" ? el : undefined); } catch (e) {} }
    return true;
  }

  /* ================== UI ================== */
  let bar, log, startBtn;
  function ui() {
    if (bar) return;
    bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 12px;font:bold 13px Arial;color:#fff;background:#5b2a86;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    bar.textContent = MSAN ? "🔁 غيّر البورت (MSAN Replacement) — جاهز"
      : PCHECK ? "🔎 تحديث البورت (متابعة الطلب) — جاهز"
      : "⚙️ تحديث ملف البورتات — جاهز";
    // زر تشغيل يدوى (للبورتات فقط — MSAN/PCHECK بيشتغلوا تلقائى فى نافذتهم)
    if (!MSAN && !PCHECK) {
      startBtn = document.createElement("button");
      startBtn.textContent = "🔄 ابدأ تحديث ملف البورتات";
      startBtn.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:14px 20px;border:0;border-radius:10px;background:#2e7d32;color:#fff;font:bold 15px Arial;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45);direction:rtl";
      startBtn.onmouseenter = () => (startBtn.style.background = "#1b5e20");
      startBtn.onmouseleave = () => (startBtn.style.background = "#2e7d32");
      startBtn.onclick = () => { startBtn.disabled = true; startBtn.style.background = "#9e9e9e"; startBtn.textContent = "⏳ جارٍ التحديث…"; run().catch((e) => banner("❌ " + (e && e.message || e), "#c62828")); };
    }
    log = document.createElement("div");
    log.style.cssText = "position:fixed;bottom:0;left:0;right:0;max-height:22vh;overflow:auto;z-index:2147483646;padding:6px 12px;font:12px/1.5 monospace;color:#0f0;background:rgba(0,0,0,.82);direction:ltr;white-space:pre-wrap";
    const root = document.body || document.documentElement;
    root.appendChild(bar); if (startBtn) root.appendChild(startBtn); root.appendChild(log);
  }
  function banner(msg, color) { ui(); bar.style.background = color || "#5b2a86"; bar.textContent = msg; }
  function logln(msg) { ui(); log.textContent += msg + "\n"; log.scrollTop = log.scrollHeight; console.log(msg); }

  /* ================== Service-Flow ================== */
  async function sfGetCabins() {
    const r = await window.fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/phone-ports/cabins", {
      headers: { "X-DZS-Token": SF_TOKEN },
    });
    const j = await r.json();
    return Array.isArray(j.cabins) ? j.cabins : [];
  }
  async function sfPostPorts(cabin, rows) {
    const items = rows.map((o) => Object.assign({ msanCode: cabin }, o));
    const r = await window.fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/phone-ports/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DZS-Token": SF_TOKEN },
      body: JSON.stringify({ items }),
    });
    return r.json();
  }

  /* ================== تسجيل الدخول ================== */
  const onLoginPage = () => /#\/login/i.test(location.hash) || !!document.querySelector("input[type='password']");

  // Enter على حقل الباسورد (fallback لو زر Login مش بيستجيب للنقر)
  function pressEnter(el) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }
  }
  async function doLoginOnce() {
    const pass = await waitFor(() => document.querySelector("input[type='password']"), 15000);
    if (!pass) return !onLoginPage();
    const inputs = [...document.querySelectorAll("input")].filter(visible);
    const pIdx = inputs.indexOf(pass);
    const userInput = inputs.slice(0, pIdx).reverse().find((i) => !/password/i.test(i.type)) || inputs[0];
    if (userInput) { setNgValue(userInput, ""); setNgValue(userInput, USER); }
    setNgValue(pass, PASS);
    await sleep(500);
    const btn = findButtonByText(/^\s*login\s*$|تسجيل|دخول/i) || findButtonByText(/login/i);
    // نضغط بـ clickEl (Angular بيستجيب له أفضل من .click العادى) + Enter كـ fallback
    if (btn) { clickEl(btn); } else { logln("⚠️ مالقتش زر Login — هبعت Enter."); }
    pressEnter(pass);
    let left = await waitFor(() => !onLoginPage(), 20000);
    // لسه على اللوجين؟ جرّب مرة تانية (نقرة + Enter) قبل ما نستسلم
    if (!left) {
      logln("↻ لسه على اللوجين بعد أول ضغط — إعادة الضغط…");
      const btn2 = findButtonByText(/^\s*login\s*$|تسجيل|دخول/i) || findButtonByText(/login/i);
      if (btn2) clickEl(btn2);
      pressEnter(pass);
      left = await waitFor(() => !onLoginPage(), 15000);
    }
    await sleep(1200);
    return !onLoginPage();
  }
  async function ensureLoggedIn() {
    if (!onLoginPage()) return true;
    banner("🔐 تسجيل الدخول…", "#6a1b9a");
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ok = await doLoginOnce();
      if (ok) { logln("🔓 تم تسجيل الدخول."); return true; }
      logln("⚠️ محاولة تسجيل دخول " + attempt + " لم تنجح — إعادة…");
      await sleep(1500);
    }
    return !onLoginPage();
  }

  /* ================== [تدفّق 1] فتح Get MSAN Data (تحديث البورتات) ================== */
  async function gotoGetMsan() {
    if (onLoginPage()) {
      logln("🔁 الجلسة سقطت — إعادة تسجيل الدخول قبل فتح الصفحة…");
      const ok = await ensureLoggedIn();
      if (!ok) return null;
      await sleep(800);
    }
    if (!new RegExp(GET_MSAN_HASH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(location.hash)) {
      location.hash = GET_MSAN_HASH;
    }
    const input = await waitFor(() => {
      if (onLoginPage()) return null;
      const lbl = [...document.querySelectorAll("label,span,div,th,h1,h2,h3,p")]
        .find((e) => visible(e) && /cabin\s*code/i.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 40);
      if (lbl) {
        const scope = lbl.closest("form, .card, .panel, div") || document;
        const near = [...scope.querySelectorAll("input")].filter((i) => visible(i) && !/password/i.test(i.type));
        if (near.length) return near[0];
      }
      const any = [...document.querySelectorAll("input[type='text'], input:not([type])")].filter(visible);
      return any[0] || null;
    }, 20000);
    if (onLoginPage()) return null;
    return input;
  }

  // ⚠️ جدول البوابة مقسّم صفحات (٥–٦ صفوف معروضة من ١١١٩). فى DataTables العادى
  // (client-side) الدالة rows() بترجّع **كل** الصفوف مش المعروض بس — وده المطلوب.
  // لكن لو البوابة server-side مابيبقاش فى الذاكرة غير الصفحة الحالية، فبنكشف ده
  // (صفوف الجدول أقل من المتوقّع) ونوسّع الصفحة مؤقتاً ثم نرجّعها زى ما كانت.
  function scrapeDataTable(minExpected) {
    try {
      const $ = window.jQuery || window.$;
      if (!$ || !$.fn || !$.fn.DataTable) return null;
      const tbl = [...document.querySelectorAll("table")].find((t) => $.fn.dataTable && $.fn.dataTable.isDataTable(t));
      if (!tbl) return null;
      const dt = $(tbl).DataTable();
      const heads = [...tbl.querySelectorAll("thead th")].map((th) => norm(th.textContent));
      const toObjs = (data) => data.map((row) => {
        if (Array.isArray(row)) { const o = {}; heads.forEach((h, i) => { o[h] = row[i]; }); return o; }
        return row;
      });
      let data = dt.rows().data().toArray();
      if (minExpected && data.length && data.length < minExpected) {
        let prevLen = null;
        try {
          prevLen = dt.page.len();
          if (prevLen !== -1) {
            dt.page.len(-1).draw(false);
            data = dt.rows().data().toArray();
            console.log("[PORTS] الجدول كان صفحة واحدة (" + prevLen + ") — وسّعناه لـ " + data.length + " صف");
          }
        } catch (e) { /* التوسيع مش متاح — نكمّل باللى معانا */ }
        finally { try { if (prevLen != null && prevLen !== -1) dt.page.len(prevLen).draw(false); } catch (e) {} }
      }
      if (!data.length) return null;
      return toObjs(data);
    } catch (e) { return null; }
  }

  // بيانات الشبكة (JSON) مابترجّعش عمود Shelf، رغم إن **جدول الصفحة نفسه فيه
  // عمود Shelf بقيمة**. هنا بنكمّل أى خانة فاضية من صف الجدول المقابل (مطابقة
  // برقم التليفون). إضافة آمنة: القيمة الموجودة فى الـ JSON بتفضل زى ما هى، ولو
  // الجدول مش متاح بنرجّع الصفوف من غير تغيير.
  // ⚠️ خاص بتدفّق تحديث البورتات (sf_ports) بس — مالوش أى علاقة بتغيير البورت.
  function mergeFromTable(rows) {
    try {
      if (!Array.isArray(rows) || !rows.length) return rows;
      const tbl = scrapeDataTable(rows.length);
      if (!tbl || !tbl.length) return rows;
      if (tbl.length < rows.length) {
        console.warn("[PORTS] جدول الصفحة فيه " + tbl.length + " صف بس مقابل " +
                     rows.length + " من الشبكة — هنكمّل اللى نقدر عليه.");
      }
      const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "");
      const clean = (v) => String(v == null ? "" : v).replace(/<[^>]*>/g, "").trim();
      const byPhone = new Map();
      for (const t of tbl) {
        const ph = digits(pickKey(t, "phonenumber", "phone", "msisdn"));
        if (ph && !byPhone.has(ph)) byPhone.set(ph, t);
      }
      if (!byPhone.size) return rows;
      const KEYS = ["areacode", "msancode", "frame", "row", "column", "shelf", "slot",
                    "portnumber", "porttype", "voicestatus", "datastatus", "operator"];
      let filled = 0;
      const out = rows.map((o) => {
        const ph = digits(pickKey(o, "phonenumber", "phone", "msisdn"));
        const t = ph && byPhone.get(ph);
        if (!t) return o;
        const merged = Object.assign({}, o);
        for (const k of KEYS) {
          if (pickKey(merged, k) !== "") continue;   // موجودة خلاص من الـ JSON
          const v = clean(pickKey(t, k));
          if (v) { merged[k] = v; filled++; }
        }
        return merged;
      });
      const withShelf = out.filter((o) => pickKey(o, "shelf") !== "").length;
      console.log("[PORTS] الدمج: كمّلنا " + filled + " قيمة من الجدول · " +
                  withShelf + "/" + out.length + " صف بقى ليه شيلف");
      return out;
    } catch (e) { return rows; }
  }

  async function searchAndRead(input, cabin) {
    if (onLoginPage() || !input || !input.isConnected) return null;
    setNgValue(input, cabin);
    await sleep(400);
    const marker = captures.length;
    const searchBtn = findSearchButton(input);
    if (searchBtn) { logln("🔍 ضغط Search لـ " + cabin); clickEl(searchBtn); }
    else { logln("⚠️ لم أجد زر Search — أُرسل Enter."); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); }
    const end = Date.now() + SEARCH_WAIT_MS;
    while (Date.now() < end) {
      if (captures.length > marker) {
        // كمّل الأعمدة الناقصة (الشيلف) من جدول الصفحة، بعد مهلة صغيرة يرسم فيها Angular
        const jsonRows = captures[captures.length - 1].rows;
        await sleep(900);
        return mergeFromTable(jsonRows);
      }
      const scraped = scrapeDataTable();
      if (scraped && scraped.length) return scraped;
      if (/no\s*data|no\s*matching|0\s*entries|no\s*record/i.test((document.body.innerText || ""))) return [];
      await sleep(400);
    }
    return null;
  }

  const pickKey = (o, ...names) => {
    if (!o || typeof o !== "object") return "";
    const lower = {};
    for (const k of Object.keys(o)) lower[k.toLowerCase().replace(/[\s_]+/g, "")] = o[k];
    for (const n of names) { const v = lower[n.toLowerCase().replace(/[\s_]+/g, "")]; if (v != null && String(v).trim() !== "") return String(v).trim(); }
    return "";
  };
  function downloadDiagCsv(rows) {
    if (!rows.length) return;
    const SEP = ";";
    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const header = ["كود الأمسان", "رقم التليفون", "Frame", "Row", "Column", "Shelf", "Slot", "Port", "Port Type", "Voice Status", "Data Status", "Operator"].join(SEP);
    const body = rows.map((r) => [r.cabin, r.phone, r.frame, r.row, r.col, r.shelf, r.slot, r.port, r.ptype, r.voice, r.data, r.operator].map(esc).join(SEP)).join("\r\n");
    const csv = "﻿" + header + "\n" + body;
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "ports_captured_" + rows.length + "rows.csv";
      (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      logln("📥 اتحمّل شيت التشخيص: " + rows.length + " رقم.");
    } catch (e) { logln("csv err: " + (e && e.message || e)); }
  }

  let running = false;
  async function run() {
    if (running) return; running = true;
    const allCaptured = [];
    try {
      banner("🔐 التأكد من تسجيل الدخول…", "#6a1b9a");
      await ensureLoggedIn();
      banner("📥 جلب أكواد الأمسان من Service-Flow…", "#1565c0");
      const cabins = await sfGetCabins();
      logln("عدد أكواد الأمسان المخزّنة: " + cabins.length);
      if (!cabins.length) { banner("⚠️ لا توجد أكواد أمسان مخزّنة فى الموقع.", "#ef6c00"); running = false; return; }
      let totalRows = 0, totalUp = 0, okCabins = 0, failCabins = 0;
      const input0 = await gotoGetMsan();
      if (!input0) { banner("❌ لم أجد خانة Cabin Code.", "#c62828"); running = false; return; }
      let loginFails = 0;
      for (let i = 0; i < cabins.length; i++) {
        const cabin = cabins[i];
        banner("⏳ (" + (i + 1) + "/" + cabins.length + ") أمسان " + cabin + " …", "#1565c0");
        const input = await gotoGetMsan();
        if (!input) {
          loginFails++; failCabins++;
          logln("⛔ " + cabin + " — تعذّر فتح صفحة Cabin Code (الجلسة/اللوجين).");
          if (loginFails >= 4) { banner("❌ تعذّر إبقاء الجلسة مفتوحة — تم الإيقاف. سجّل دخول يدوياً وأعد المحاولة.", "#c62828"); break; }
          await sleep(BETWEEN_CABINS_MS); continue;
        }
        loginFails = 0;
        const rows = await searchAndRead(input, cabin);
        if (rows == null) { failCabins++; logln("⏱️ " + cabin + " — انتهت المهلة بدون بيانات."); await sleep(BETWEEN_CABINS_MS); continue; }
        if (!rows.length) { logln("• " + cabin + " — 0 صف."); okCabins++; await sleep(BETWEEN_CABINS_MS); continue; }
        for (const o of rows) allCaptured.push({
          cabin,
          phone: pickKey(o, "phonenumber", "phone", "msisdn"),
          frame: pickKey(o, "frame"), row: pickKey(o, "row"), col: pickKey(o, "column", "col"),
          shelf: pickKey(o, "shelf"), slot: pickKey(o, "slot"), port: pickKey(o, "portnumber", "port", "portno"),
          ptype: pickKey(o, "porttype"), voice: pickKey(o, "voicestatus", "voice"), data: pickKey(o, "datastatus", "data"), operator: pickKey(o, "operator", "op"),
        });
        try {
          const res = await sfPostPorts(cabin, rows);
          const up = (res && (res.inserted ?? res.total)) || 0;
          totalRows += rows.length; totalUp += up; okCabins++;
          logln("✓ " + cabin + " — " + rows.length + " صف، تحديث/إضافة: " + up);
        } catch (e) { failCabins++; logln("✗ " + cabin + " — فشل الرفع: " + (e && e.message || e)); }
        await sleep(BETWEEN_CABINS_MS);
      }
      banner("✅ خلص. أمسان ناجح: " + okCabins + " / صفوف: " + totalRows + " / محدَّث: " + totalUp + (failCabins ? " / فشل: " + failCabins : ""), "#2e7d32");
      logln("=== انتهى: " + okCabins + " أمسان، " + totalRows + " صف، " + totalUp + " محدَّث/مضاف، " + failCabins + " فشل ===");
      downloadDiagCsv(allCaptured);
    } finally {
      running = false;
      try { sessionStorage.removeItem("sf_ports_auto"); } catch (e) {}
    }
  }

  /* ================== [تدفّق 2] غيّر البورت (MSAN Replacement) — رقم واحد ==================
     ماركر مستقل (sf_msan) ونافذة مستقلة (sf_msan_replace) فمفيش أى تعارض مع تدفّق البورتات.
     بيملأ Old/New Cabin Code + يحقن ملف CSV بالرقم فى خانة الرفع، ويسيب الـ Submit ليك يدوياً. */

  // يبنى ملف CSV بنفس أعمدة التمبلت: Area code,Phone number,PortType,speed
  function buildMsanFile(data) {
    const header = "Area code,Phone number,PortType,speed";
    const row = [data.area || "88", data.phone, data.pt || "SV", data.sp || "WE30"].join(",");
    const csv = header + "\r\n" + row + "\r\n";
    return new File([csv], "MSAN_Replacement.csv", { type: "text/csv" });
  }
  // يحقن ملف فى input[type=file] عبر DataTransfer (بديل اختيار المستخدم — الموقع بيقرأ input.files)
  function injectFile(input, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (e) { logln("inject err: " + (e && e.message || e)); return false; }
  }

  async function gotoMsanReplacement() {
    if (onLoginPage()) {
      const ok = await ensureLoggedIn();
      if (!ok) return false;
      await sleep(800);
    }
    if (!/msan-replacement/i.test(location.hash)) location.hash = MSAN_REPL_HASH;
    // ننتظر ظهور حقول الفورم
    const oldIn = await waitFor(() => {
      if (onLoginPage()) return null;
      return document.querySelector("input[formcontrolname='oldMsanCode']");
    }, 25000);
    return !!oldIn && !onLoginPage();
  }

  // يملأ الفورم مرة واحدة ويضغط Submit. يرجّع true لو اتضغط Submit فعلاً.
  async function fillAndSubmitMsan(data) {
    const ok = await gotoMsanReplacement();
    if (!ok) { logln("⛔ تعذّر فتح صفحة MSAN Replacement."); return false; }
    const oldIn = document.querySelector("input[formcontrolname='oldMsanCode']");
    const newIn = document.querySelector("input[formcontrolname='newMsanCode']");
    const fileIn = document.querySelector("input.custom-file-input, input[type='file']");
    if (!oldIn || !newIn) { logln("⛔ لم أجد حقول Old/New Cabin Code."); return false; }
    setNgValue(oldIn, data.old);
    setNgValue(newIn, data.new);
    logln("✏️ Old=" + data.old + " | New=" + data.new);
    let fileOk = false;
    if (fileIn) {
      fileOk = injectFile(fileIn, buildMsanFile(data));
      logln(fileOk ? ("📎 اتحقن الملف: " + data.area + "," + data.phone + "," + data.pt + "," + data.sp) : "⚠️ تعذّر حقن الملف.");
    } else { logln("⚠️ لم أجد خانة رفع الملف."); }
    await sleep(1200); // Angular يعالج الملف/التحقّق
    const submitBtn = findButtonByText(/^\s*submit\s*$|إرسال|تنفيذ/i);
    if (fileOk && submitBtn) { clickEl(submitBtn); logln("🚀 اتضغط Submit."); return true; }
    logln(submitBtn ? "⚠️ الملف مش متحقن — مضغطتش Submit." : "⚠️ مالقتش زر Submit.");
    return false;
  }

  let msanRunning = false;
  async function runMsan() {
    if (msanRunning) return; msanRunning = true;
    try {
      const data = MSAN || {};
      if (!data.phone) { banner("❌ لا يوجد رقم للتغيير.", "#c62828"); return; }
      // حلقة: املأ + Submit، وبعدها راقب. لو البورتال رجّعنا للّوجين (الجلسة سقطت) → سجّل دخول
      // وأعِد نفس الخطوات. لو مرجعش للّوجين (نجح غالباً) → قِف. أقصى عدد محاولات لمنع أى تكرار لا نهائى.
      // ملاحظة: مش دايماً بيرجع للّوجين — فالخروج الطبيعى لما مايرجعش.
      const MAX = 5;
      for (let attempt = 1; attempt <= MAX; attempt++) {
        banner("🔁 غيّر البورت — رقم " + data.phone + " (محاولة " + attempt + ")", "#00695c");
        await ensureLoggedIn();
        const submitted = await fillAndSubmitMsan(data);
        if (!submitted) { banner("✅ اتملأ الفورم — راجع/اضغط Submit بنفسك (مش لاقى الملف/الزر).", "#ef6c00"); return; }
        // بعد Submit: نراقب 30 ثانية — waitFor بيرجع فوراً أول ما تظهر صفحة اللوجين (bounce → إعادة)،
        // أو بعد الـ 30 ثانية كاملة لو مظهرتش (يبقى اتأكدنا إن الـ Submit نجح فعلاً → نقفل التاب).
        banner("⏳ اتعمل Submit — بنتأكد 30 ثانية إنه مرجعش للّوجين…", "#00695c");
        const bounced = await waitFor(() => onLoginPage(), 30000);
        if (!bounced) {
          banner("✅ تم الإرسال (Submit) ونجح (مفيش رجوع للّوجين خلال 30 ثانية) — بيتقفل التاب. لمتابعة النتيجة اضغط «تحديث البورت».", "#2e7d32");
          logln("✅ اتأكدنا 30 ثانية إنه مرجعش للّوجين → نجح. التاب بيتقفل دلوقتى.");
          // اتأكدنا إن الـ Submit نجح → نقفل التاب (النافذة اتفتحت بـ window.open فمسموح غلقها بالسكربت)
          try { window.close(); } catch (e) {}
          return;
        }
        banner("🔁 رجع للّوجين بعد Submit — إعادة الدخول وتكرار الخطوات…", "#6a1b9a");
        logln("↩️ Bounce للّوجين — إعادة المحاولة " + (attempt + 1) + "/" + MAX);
        await sleep(800);
      }
      banner("⚠️ جرّبنا " + MAX + " مرات ولسه بيرجع للّوجين — اعمل العملية يدوى أو أعد المحاولة.", "#c62828");
    } finally {
      msanRunning = false;
      // مابنمسحش MSAN_KEY — لو حصل reload كامل للّوجين، الـ auto-fire هيعيد runMsan. البيانات
      // بتتستبدل تلقائياً أول ما تفتح «غيّر البورت» لرقم جديد من Service-Flow.
    }
  }

  /* ================== [تدفّق 3] تحديث البورت (يدوى) — Search For My Requests ==================
     يُستدعى يدوياً من زر «تحديث البورت» فى بحث برقم التليفون (بماركر sf_pcheck). يفتح Search For
     My Requests مرة واحدة، يطابق صف الرقم بتاعنا، ولو COMPLETED يفتح التفاصيل ويجيب New Frame +
     New Msan Code ويحدّث بيان البورت فى Service-Flow. لو غير COMPLETED يسجّل الحالة فى جدول المتابعة.
     مفيش متابعة تلقائية كل نص ساعة — العملية تتم مرة واحدة وتقف. (نطابق بالرقم فقط.) */
  const todayISO = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
  async function sfSeen(phone) {
    try {
      const r = await window.fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/port-change/seen?phone=" + encodeURIComponent(phone), { headers: { "X-DZS-Token": SF_TOKEN } });
      const j = await r.json(); return Array.isArray(j.requestIds) ? j.requestIds.map(String) : [];
    } catch (e) { return []; }
  }
  async function sfIngestResult(payload) {
    // ⚠️ مهلة إجبارية: من غيرها لو الطلب علّق (شبكة/بروكسى/CORS) الـ fetch مابيرجعش
    // **أبداً** — فالتدفّق بيقف صامت بعد سطر «COMPLETED … Frame=…» على طول: لا رسالة
    // نجاح ولا فشل، والبورت اتقرا فعلاً بس ماتسجّلش. دلوقتى بيقطع بعد 30 ثانية
    // ويرجّع سبب واضح يظهر فى البانر واللوج.
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const tmo = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (e) {} }, 30000);
    try {
      const opts = {
        method: "POST", headers: { "Content-Type": "application/json", "X-DZS-Token": SF_TOKEN },
        body: JSON.stringify(payload),
      };
      if (ctrl) opts.signal = ctrl.signal;
      const r = await window.fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/port-change/ingest", opts);
      // لازم نتأكد إن السيرفر قبلها فعلاً — قبل كده كنا بنرجّع الـ json مهما كانت الحالة،
      // فأى 401/500 كان بيعدّى وتظهر رسالة نجاح خضراء والبيانات مش متحدّثة.
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) return { ok: false, error: (j && j.message) || ("HTTP " + r.status) };
      return Object.assign({ ok: true }, j);
    } catch (e) {
      const msg = (e && e.name === "AbortError")
        ? "الرفع لـ Service-Flow علّق (عدّى 30 ثانية بلا رد)"
        : String((e && e.message) || e);
      return { ok: false, error: msg };
    } finally { clearTimeout(tmo); }
  }
  // قراءة قيمة حقل بعنوان محدد داخل نافذة تفاصيل الطلب (label نصّه == العنوان بالظبط → أقرب input)
  // قراءة قيمة جنب عنوان معيّن. الإصدار القديم كان بيشترط <label> نصه مطابق تماماً
  // والقيمة داخل <input> — وشاشة تفاصيل الطلب بتعرض العنوان كـ th/span/div (وأحياناً
  // بنقطتين فى آخره) والقيمة كنص عادى، فكان بيرجع فاضى ويقول «معرفتش أقرأ البورت».
  // دلوقتى بندوّر فى أى عنصر عنوان، وبنقرا القيمة من input أو من العنصر اللى بعده أو
  // من باقى نص المجموعة. وبيقبل أكتر من اسم بديل للعنوان.
  function readLabeledValue() {
    const targets = [].slice.call(arguments).map(norm).filter(Boolean);
    const strip = function (x) { return x.replace(/[::]+$/, ""); };
    const els = document.querySelectorAll("label, th, td, dt, strong, b, span, div, p");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var txt = strip(norm(el.textContent));
      if (!txt || txt.length > 40) continue;
      var hit = false;
      for (var j = 0; j < targets.length; j++) if (txt === strip(targets[j])) { hit = true; break; }
      if (!hit) continue;
      var grp = el.closest(".col, .form-group, .mb-3, .row, [class*='col']") || el.parentElement;
      if (grp) {
        var inp = grp.querySelector("input, textarea, select");
        var v = inp ? String(inp.value || "").trim() : "";
        if (v) return v;
      }
      for (var sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
        var sv = (sib.textContent || "").trim();
        if (sv) return sv;
      }
      if (grp) {
        var whole = (grp.textContent || "").trim();
        var raw = (el.textContent || "").trim();
        var k = whole.indexOf(raw);
        if (k >= 0) {
          var after = whole.slice(k + raw.length).replace(/^[\s:\u061B\u066B\-]+/, "").trim();
          if (after) return after;
        }
      }
    }
    return "";
  }
  // تشخيص: العناوين اللى فيها Frame/Msan/Port على الشاشة دلوقتى — لو القراءة فشلت
  // نطبعها فى اللوج فنعرف الاسم الحقيقى بدل التخمين.
  function dumpPortLabels() {
    var out = [];
    var els = document.querySelectorAll("label, th, td, dt, strong, b, span, div, p");
    for (var i = 0; i < els.length && out.length < 25; i++) {
      var raw = (els[i].textContent || "").trim();
      if (!raw || raw.length > 40) continue;
      if (!/frame|msan|port|slot|shelf/i.test(raw)) continue;
      if (out.indexOf(raw) < 0) out.push(raw);
    }
    return out;
  }
  // صفوف جدول Search For My Requests
  function pcReadRequestRows() {
    for (const tbl of [...document.querySelectorAll("table")]) {
      const heads = [...tbl.querySelectorAll("thead th")].map((th) => norm(th.textContent));
      const iReq = heads.findIndex((h) => /requestid/.test(h));
      const iPhone = heads.findIndex((h) => /phonenumber|phone/.test(h));
      const iStatus = heads.findIndex((h) => /status/.test(h));
      if (iReq < 0 || iPhone < 0 || iStatus < 0) continue;
      const iRes = heads.findIndex((h) => /reservation/.test(h));
      const iDate = heads.findIndex((h) => /requestdate|date/.test(h));
      const rows = [];
      for (const tr of tbl.querySelectorAll("tbody tr")) {
        const tds = [...tr.querySelectorAll("td")];
        if (!tds.length || !tds[iReq]) continue;
        rows.push({
          requestId: (tds[iReq].textContent || "").trim(),
          phone: (tds[iPhone] ? tds[iPhone].textContent : "").replace(/\D/g, ""),
          status: (tds[iStatus] ? tds[iStatus].textContent : "").trim(),
          reservationCode: iRes >= 0 && tds[iRes] ? tds[iRes].textContent.trim() : "",
          requestDate: iDate >= 0 && tds[iDate] ? tds[iDate].textContent.trim() : "",
          linkEl: tds[iReq].querySelector("a") || tds[iReq],
        });
      }
      return rows;
    }
    return [];
  }
  async function gotoSearchRequests(dateISO) {
    // ممكن صفحة المتابعة ترجع للّوجين — فنعيد الدخول والمحاولة (مش نستنى نص ساعة).
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (onLoginPage()) { logln("🔁 المتابعة لقت لوجين — إعادة الدخول…"); const ok = await ensureLoggedIn(); if (!ok) return false; await sleep(800); }
      if (!/search-for-my-requests/i.test(location.hash)) location.hash = SEARCH_REQ_HASH;
      const dateIn = await waitFor(() => document.querySelector("input[formcontrolname='RequestDateFrom']") || (onLoginPage() ? "LOGIN" : null), 18000);
      if (onLoginPage() || dateIn === "LOGIN") { await sleep(600); continue; } // بانت اللوجين → أعِد
      if (!dateIn) return false;
      if (String(dateIn.value || "") !== dateISO) setNgValue(dateIn, dateISO); // افتراضيه اليوم — نحطه بس لو مختلف
      // نضبط تاريخ «إلى» على اليوم كمان (لو موجود) عشان النتائج تبقى محصورة فى تاريخ اليوم فقط
      const toIn = document.querySelector("input[formcontrolname='RequestDateTo']");
      if (toIn && String(toIn.value || "") !== dateISO) setNgValue(toIn, dateISO);
      await sleep(400);
      const btn = findSearchButton(dateIn) || findButtonByText(/^\s*search\s*$/i);
      if (btn) clickEl(btn);
      // ننتظر الجدول يحمّل فعلاً (صفوف ظهرت أو رسالة «مفيش بيانات») بدل مهلة ثابتة —
      // المهلة الثابتة كانت ممكن تخلص قبل ما النتايج تترسم فنقرا جدول فاضى.
      await sleep(600);
      await waitFor(() => pcReadRequestRows().length > 0
        || /no\s*data|no\s*matching|0\s*entries|no\s*record|showing\s*0/i.test(document.body.innerText || ""), 12000);
      return true;
    }
    return false;
  }
  // هل تاريخ الصف = تاريخ اليوم؟ (بجانب فلتر البحث From/To = اليوم، ده تأكيد إضافى فى الكود).
  //   فاضى/غير مفهوم → نثق فى فلتر البحث (نرجّع true). سنة 4 أرقام مختلفة عن سنة اليوم → false.
  function pcDateIsToday(str) {
    if (!str) return true;
    const s = String(str).trim();
    const now = new Date(); const Y = now.getFullYear(), M = now.getMonth() + 1, D = now.getDate();
    // (1) البوابة بتعرض التاريخ باسم الشهر بالإنجليزى: "Aug 5, 2026".
    //     المنطق القديم كان بيدوّر على الشهر **كرقم** (8 أو 08) فمكانش بيلاقيه ويعتبر
    //     الطلب مش بتاريخ اليوم — فيقول «لا يوجد طلب» رغم إن الطلب ظاهر فى الجدول.
    //     هنا بنقراه مباشرةً لأن JS بيفهم الصيغة دى.
    if (/[A-Za-z]{3}/.test(s)) {
      const t = new Date(s.replace(/,/g, " "));
      if (!isNaN(t.getTime())) return t.getFullYear() === Y && (t.getMonth() + 1) === M && t.getDate() === D;
    }
    // (2) تواريخ رقمية بحتة: نفضل على المنطق القديم — مانحاولش نخمّن dd/mm ولا mm/dd،
    //     بنتأكد بس إن اليوم والشهر والسنة موجودين فى النص.
    const p2 = (n) => String(n).padStart(2, "0");
    const years = (s.match(/\b\d{4}\b/g) || []).map(Number);
    if (years.length && years.indexOf(Y) < 0) return false;   // سنة تانية → مش النهارده
    if (!years.length) return true;                            // مفيش سنة واضحة → نثق فى الفلتر
    const hasNum = (n) => new RegExp("(^|\\D)" + n + "(\\D|$)").test(s) || new RegExp("(^|\\D)" + p2(n) + "(\\D|$)").test(s);
    return hasNum(D) && hasNum(M);                             // نفس السنة → لازم اليوم والشهر كمان
  }
  // الأحدث بين طلبات نفس الرقم: الأكبر Request ID رقمياً (WE بيزيده تصاعدياً)، وإلا آخر صف فى الجدول.
  function pcPickLatest(list) {
    const num = (r) => { const n = parseInt(String(r.requestId).replace(/\D/g, ""), 10); return isNaN(n) ? -1 : n; };
    const anyNum = list.some((r) => num(r) >= 0);
    if (anyNum) return list.slice().sort((a, b) => num(b) - num(a))[0];
    return list[list.length - 1];
  }

  // تحديث البورت اليدوى — فحص مرة واحدة للرقم (طلب تغيير بورت بتاريخ اليوم) ثم يقف.
  let pcheckRunning = false;
  async function runPcheck() {
    if (pcheckRunning) return; pcheckRunning = true;
    try {
      const data = PCHECK || {};
      const phone = String(data.phone || "").replace(/\D/g, "");
      if (!phone) { banner("❌ لا يوجد رقم للمتابعة.", "#c62828"); return; }
      banner("🔎 تحديث البورت — متابعة الرقم " + phone + " …", "#00695c");
      await ensureLoggedIn();
      const dateISO = todayISO();
      if (!(await gotoSearchRequests(dateISO))) { banner("⛔ تعذّر فتح صفحة Search For My Requests.", "#c62828"); return; }
      const rows = pcReadRequestRows();
      // طلبات نفس الرقم بتاريخ اليوم فقط (لو تغيير البورت كان بتاريخ سابق → يُعتبر مفيش طلب اليوم)
      const todayRows = rows.filter((r) => r.phone === phone && r.requestId && pcDateIsToday(r.requestDate));
      if (!todayRows.length) {
        banner("• لا يوجد للرقم " + phone + " طلب تغيير بورت بتاريخ اليوم.", "#ef6c00");
        logln("• " + phone + " — مفيش طلب تغيير بورت بتاريخ اليوم على البروفيجن.");
        // تشخيص: نعرض اللى الجدول شايفه فعلاً — لو فيه صفوف للرقم واتفلترت بالتاريخ
        // يبقى قراءة التاريخ هى المشكلة مش غياب الطلب.
        const same = rows.filter((r) => r.phone === phone);
        if (same.length) {
          logln("🔎 الجدول فيه " + same.length + " طلب للرقم ده بتواريخ: "
            + same.map((r) => (r.requestDate || "(بدون تاريخ)") + " [" + r.requestId + "]").join(" ، "));
        } else if (rows.length) {
          logln("🔎 الجدول فيه " + rows.length + " صف لكن مفيش منهم الرقم " + phone + ".");
        }
        return;
      }
      // نستبعد المسجّل عندنا قبل كده (اتحدّث/اتسجّل) — عشان الضغط تانى ميعيدش
      const seen = await sfSeen(phone);
      const fresh = todayRows.filter((r) => seen.indexOf(r.requestId) < 0);
      if (!fresh.length) {
        banner("✅ طلب تغيير البورت للرقم " + phone + " اتسجّل/اتحدّث قبل كده.", "#2e7d32");
        logln("ℹ️ " + phone + " — كل طلبات اليوم متسجّلة قبل كده (Request IDs: " + todayRows.map((r) => r.requestId).join(", ") + ").");
        return;
      }
      // لو فيه أكتر من طلب غير محدّث → ناخد الأحدث على البروفيجن
      const mine = pcPickLatest(fresh);
      if (fresh.length > 1) logln("ℹ️ " + fresh.length + " طلبات غير محدّثة — اخترنا الأحدث Request " + mine.requestId + ".");
      const status = (mine.status || "").toUpperCase();

      if (/COMPLETED/.test(status)) {
        const NEW_FRAME_LABELS = ["New Frame", "New Frame No", "New FrameNo", "New Frame Number", "NewFrame", "Frame New", "New Port"];
        const NEW_MSAN_LABELS  = ["New Msan Code", "New MSAN", "New Msan", "New MsanCode", "NewMsanCode", "Msan Code New"];
        // القيمة أحياناً بترجع ومعاها اسم الحقل («New Frame 131») حسب شكل الـ DOM —
        // بنشيل اسم الحقل من أولها فتبقى «131».
        const stripLabel = (v, labels) => {
          let out = String(v || "").trim();
          for (const l of labels) {
            const esc = l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
            out = out.replace(new RegExp("^\\s*" + esc + "\\s*[::\\-]?\\s*", "i"), "").trim();
          }
          return out;
        };
        const readNew = () => ({
          frame: stripLabel(readLabeledValue.apply(null, NEW_FRAME_LABELS), NEW_FRAME_LABELS),
          msan: stripLabel(readLabeledValue.apply(null, NEW_MSAN_LABELS), NEW_MSAN_LABELS),
        });
        // فتح تفاصيل الطلب = الضغط على رقم Request Id. أحياناً الضغطة الأولى مابتفتحش
        // (الرابط لسه بيترسم/Angular)، فبنعيد المحاولة لحد ما القيم تظهر فعلاً.
        let newFrame = "", newMsan = "";
        for (let attempt = 1; attempt <= 3; attempt++) {
          const link = (mine.linkEl && mine.linkEl.querySelector ? (mine.linkEl.querySelector("a") || mine.linkEl) : mine.linkEl);
          if (link) clickEl(link);
          await waitFor(() => { const r = readNew(); return r.frame || r.msan; }, attempt === 1 ? 12000 : 6000);
          const r = readNew(); newFrame = r.frame; newMsan = r.msan;
          if (newFrame || newMsan) break;
          logln("… محاولة " + attempt + ": تفاصيل الطلب مافتحتش/القيم لسه مش ظاهرة.");
          await sleep(1200);
        }
        const closeBtn = [...document.querySelectorAll("button, .close, [aria-label='Close']")].find((b) => visible(b) && /×|close/i.test((b.textContent || b.getAttribute("aria-label") || "")));
        // تأكيد أنه تم فعلاً: لازم نكون قرأنا البورت الجديد قبل ما نسجّل/نحدّث
        if (!newFrame && !newMsan) {
          if (closeBtn) clickEl(closeBtn);
          banner("⚠️ الطلب COMPLETED بس معرفتش أقرأ البورت الجديد — جرّب «تحديث البورت» تانى.", "#ef6c00");
          logln("⚠️ " + phone + " — COMPLETED لكن مفيش New Frame/Msan مقروء → مش هنسجّل، جرّب تانى.");
          const labs = dumpPortLabels();
          console.log("[PROV] عناوين الشاشة:", labs);
          logln(labs.length
            ? ("🔎 العناوين الظاهرة: " + labs.join(" | "))
            : "🔎 مفيش أى عنوان فيه Frame/Msan على الشاشة — يبدو إن نافذة التفاصيل مافتحتش أصلاً.");
          return;
        }
        logln("✅ COMPLETED " + phone + " — Frame=" + newFrame + " | Msan=" + newMsan);
        logln("📤 بيرفع لـ Service-Flow…");   // لو التدفّق وقف هنا يبقى الرفع هو اللى علّق
        const res = await sfIngestResult({ requestId: mine.requestId, phone, oldMsan: data.old || "", newMsan: newMsan || data.new || "", newFrame, portType: data.pt || "", status: mine.status, reservationCode: mine.reservationCode, requestDate: mine.requestDate });
        if (closeBtn) clickEl(closeBtn);
        if (!res || res.ok === false) {
          banner("❌ اتقرا البورت الجديد بس الرفع لـ Service-Flow فشل: " + ((res && res.error) || "سبب غير معروف"), "#c62828");
          logln("❌ " + phone + " — فشل الرفع: " + ((res && res.error) || "?") + " (Frame=" + newFrame + " | Msan=" + newMsan + ")");
          return;
        }
        // نعرض اللى السيرفر خزّنه فعلاً — مش اللى احنا بعتناه — عشان مايبقاش فيه لبس
        const saved = "Frame " + (res.savedFrame || newFrame || "-") + " / Msan " + (res.savedMsan || newMsan || "-");
        banner("✅ اتحدّث البورت الجديد للرقم " + phone + " (" + saved + ").", "#2e7d32");
        logln(res && res.updatedPort ? "💾 اتحدّث بيان البورت فى Service-Flow (Request " + mine.requestId + " اتسجّل)." : "ℹ️ الرد: " + JSON.stringify(res));
        return;
      }

      if (/FAIL|REJECT|ERROR|CANCEL/.test(status)) {
        await sfIngestResult({ requestId: mine.requestId, phone, oldMsan: data.old || "", newMsan: data.new || "", portType: data.pt || "", status: mine.status, reservationCode: mine.reservationCode, requestDate: mine.requestDate });
        banner("⚠️ الطلب فشل (" + mine.status + ") — اتسجّل فى متابعة تغيير البورت.", "#c62828");
        logln("⚠️ " + phone + " — الحالة " + mine.status + " → اتسجّل (Request " + mine.requestId + ").");
        return;
      }

      // حالة وسيطة (لسه شغالة) — مش نهائية فمش هنسجّلها، هنسيبها للضغط تانى بعدين
      banner("⏳ الطلب لسه بحالة «" + mine.status + "» للرقم " + phone + " — لسه ماتمّش، جرّب «تحديث البورت» تانى بعدين.", "#ef6c00");
      logln("⏳ " + phone + " — الحالة " + mine.status + " (لسه ماتمّتش) → مش هنسجّل دلوقتى.");
    } catch (e) { banner("❌ " + (e && e.message || e), "#c62828"); }
    finally { pcheckRunning = false; try { sessionStorage.removeItem(PCHECK_KEY); } catch (e) {} }
  }

  /* ================== إظهار الواجهة + التشغيل التلقائى ================== */
  if (document.body) ui(); else window.addEventListener("DOMContentLoaded", ui);

  // الأولوية: PCHECK (تحديث بورت يدوى) ثم MSAN (غيّر البورت) ثم AUTO (تحديث الملفات) — كل تدفّق فى
  // نافذته المستقلة فمفيش تصادم، والحارس ده بس احتياط إضافى.
  if (PCHECK && !window.__sfPcheckFired) {
    window.__sfPcheckFired = true;
    const startNow = () => {
      banner("⚙️ فتح تلقائى — تحديث البورت…", "#00695c");
      waitFor(() => document.querySelector("input[type='password']") || !/#\/login/i.test(location.hash), 25000)
        .then(() => sleep(1000))
        .then(() => runPcheck())
        .catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
    };
    if (document.body) startNow(); else window.addEventListener("DOMContentLoaded", startNow);
  } else if (MSAN && !window.__sfMsanFired) {
    window.__sfMsanFired = true;
    const startNow = () => {
      banner("⚙️ فتح تلقائى — غيّر البورت…", "#00695c");
      waitFor(() => document.querySelector("input[type='password']") || !/#\/login/i.test(location.hash), 25000)
        .then(() => sleep(1000))
        .then(() => runMsan())
        .catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
    };
    if (document.body) startNow(); else window.addEventListener("DOMContentLoaded", startNow);
  } else if (AUTO && !window.__sfPortsAutoFired) {
    window.__sfPortsAutoFired = true;
    const startNow = () => {
      banner("⚙️ فتح تلقائى — بدء التحديث الآن…", "#5b2a86");
      waitFor(() => document.querySelector("input[type='password']") || !/#\/login/i.test(location.hash), 25000)
        .then(() => sleep(1200))
        .then(() => {
          if (startBtn) { startBtn.disabled = true; startBtn.style.background = "#9e9e9e"; startBtn.textContent = "⏳ جارٍ التحديث…"; }
          return run();
        })
        .catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
    };
    if (document.body) startNow(); else window.addEventListener("DOMContentLoaded", startNow);
  }

  // أدوات كونسول
  window.SF_PORTS_run = run;
  window.SF_MSAN_run = runMsan;
  window.SF_PCHECK_run = runPcheck;
  window.SF_PORTS_captures = () => captures;
})();
