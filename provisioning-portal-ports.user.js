// ==UserScript==
// @name         Provisioning Portal → تحديث ملف البورتات (Service-Flow)
// @namespace    service-flow.provisioning.ports
// @description  يفتح Get MSAN Data على Provisioning Portal (WE) لكل كود أمسان مخزّن فى Service-Flow، يعمل Search، يقرأ صفوف البورتات (Phone Number/Frame/Slot/…)، ويرفعها لـ Service-Flow فتستبدل نفس أرقام التليفونات فى ملف البورتات وتضيف الجديد. زرّ عائم يبدأ العملية.
// @version      1.0.3
// @match        *://provisioningportal.te.eg/provisioningPortal/*
// @connect      service-flow-menoskar42.replit.app
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mena.haleem";
  const PASS = "Mon_oskar352";
  const SF_API_BASE = "https://service-flow-menoskar42.replit.app"; // دومين Service-Flow
  const SF_TOKEN = "sf-dzs-138-ingest-2026";                        // = DZS_INGEST_TOKEN فى السيرفر
  const GET_MSAN_HASH = "#/subscriber-management/get-msan-data";
  const SEARCH_WAIT_MS = 45000;   // أقصى انتظار لظهور بيانات الأمسان بعد Search
  const BETWEEN_CABINS_MS = 1200; // راحة بسيطة بين كل أمسان والتالى

  /* ================== اعتراض الشبكة (fetch + XHR) لالتقاط صفوف الأمسان ================== */
  const captures = []; // [{ t, rows }]
  const looksLikeRow = (o) =>
    o && typeof o === "object" && !Array.isArray(o) &&
    Object.keys(o).some((k) => /phone|msisdn/i.test(k)) &&
    Object.keys(o).some((k) => /msan|frame|port|slot|shelf/i.test(k));
  function findRows(json) {
    // ابحث (DFS) عن أول Array عناصره صفوف أمسان
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
  // fetch
  const _fetch = window.fetch;
  window.fetch = function (...args) {
    return _fetch.apply(this, args).then((resp) => {
      try { resp.clone().text().then(tryCapture).catch(() => {}); } catch (e) {}
      return resp;
    });
  };
  // XHR
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
  // زرّ Search بتاع الفورم تحديداً (مش «Search» بتاع القائمة الجانبية):
  // نصعد من خانة Cabin Code لأعلى ونلاقى أقرب <button>/submit نصّه Search داخل نفس الفورم.
  function findSearchButton(input) {
    const re = /^\s*search\s*$|بحث/i;
    let node = input;
    for (let d = 0; d < 7 && node; d++) {
      const btns = [...node.querySelectorAll("button, input[type='submit'], input[type='button']")]
        .filter((b) => visible(b) && re.test((b.textContent || b.value || "")));
      if (btns.length) return btns[btns.length - 1];
      node = node.parentElement;
    }
    // احتياطى: أى button (مش <a> ومش داخل قائمة/شريط جانبى) نصّه Search
    return [...document.querySelectorAll("button, input[type='submit']")]
      .find((b) => visible(b) && re.test((b.textContent || b.value || "")) && !b.closest("nav,aside,.sidebar,.side-menu,.menu,ul")) || null;
  }
  // ضغط موثوق (mousedown/up + click) + محاولة submit للفورم
  function clickEl(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    for (const type of ["mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") { try { form.requestSubmit(el.type === "submit" ? el : undefined); } catch (e) {} }
    return true;
  }

  /* ================== UI ================== */
  let bar, log, startBtn;
  function ui() {
    if (bar) return;
    // شريط الحالة أعلى الصفحة
    bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 12px;font:bold 13px Arial;color:#fff;background:#5b2a86;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    bar.textContent = "⚙️ تحديث ملف البورتات — جاهز";
    // زرّ تشغيل عائم كبير أسفل يسار (لا يتغطّى بهيدر الموقع)
    startBtn = document.createElement("button");
    startBtn.textContent = "🔄 ابدأ تحديث ملف البورتات";
    startBtn.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:14px 20px;border:0;border-radius:10px;background:#2e7d32;color:#fff;font:bold 15px Arial;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45);direction:rtl";
    startBtn.onmouseenter = () => (startBtn.style.background = "#1b5e20");
    startBtn.onmouseleave = () => (startBtn.style.background = "#2e7d32");
    startBtn.onclick = () => { startBtn.disabled = true; startBtn.style.background = "#9e9e9e"; startBtn.textContent = "⏳ جارٍ التحديث…"; run().catch((e) => banner("❌ " + (e && e.message || e), "#c62828")); };
    log = document.createElement("div");
    log.style.cssText = "position:fixed;bottom:0;left:0;right:0;max-height:22vh;overflow:auto;z-index:2147483646;padding:6px 12px;font:12px/1.5 monospace;color:#0f0;background:rgba(0,0,0,.82);direction:ltr;white-space:pre-wrap";
    const root = document.body || document.documentElement;
    root.appendChild(bar); root.appendChild(startBtn); root.appendChild(log);
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
    // اضمن وجود msanCode لكل صف (لو ناقص من البورتال)
    const items = rows.map((o) => Object.assign({ msanCode: cabin }, o));
    const r = await window.fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/phone-ports/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DZS-Token": SF_TOKEN },
      body: JSON.stringify({ items }),
    });
    return r.json();
  }

  /* ================== تسجيل الدخول ================== */
  async function ensureLoggedIn() {
    const onLogin = () => /#\/login/i.test(location.hash) || document.querySelector("input[type='password']");
    if (!onLogin()) return true;
    banner("🔐 تسجيل الدخول…", "#6a1b9a");
    const pass = await waitFor(() => document.querySelector("input[type='password']"), 15000);
    if (!pass) return true; // غالباً بالفعل داخل
    // خانة المستخدم: أقرب input نصّى قبل الباسورد
    const inputs = [...document.querySelectorAll("input")].filter(visible);
    const pIdx = inputs.indexOf(pass);
    const userInput = inputs.slice(0, pIdx).reverse().find((i) => !/password/i.test(i.type)) || inputs[0];
    if (userInput) setNgValue(userInput, USER);
    setNgValue(pass, PASS);
    await sleep(300);
    const btn = findButtonByText(/^login$|تسجيل|دخول/i) || findButtonByText(/login/i);
    if (btn) btn.click();
    // انتظر مغادرة صفحة اللوجين
    await waitFor(() => !onLogin(), 20000);
    await sleep(1500);
    return true;
  }

  /* ================== فتح Get MSAN Data ================== */
  async function gotoGetMsan() {
    if (!new RegExp(GET_MSAN_HASH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(location.hash)) {
      location.hash = GET_MSAN_HASH;
    }
    // خانة Cabin Code: label «Cabin Code» ثم أقرب input، وإلا أول input نصّى ظاهر
    const input = await waitFor(() => {
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
    return input;
  }

  /* ================== قراءة صفوف الأمسان بعد Search ================== */
  // مسح احتياطى من جدول DataTables (لو مفيش التقاط شبكة)
  function scrapeDataTable() {
    try {
      const $ = window.jQuery || window.$;
      if (!$ || !$.fn || !$.fn.DataTable) return null;
      const tbl = [...document.querySelectorAll("table")].find((t) => $.fn.dataTable && $.fn.dataTable.isDataTable(t));
      if (!tbl) return null;
      const dt = $(tbl).DataTable();
      const heads = [...tbl.querySelectorAll("thead th")].map((th) => norm(th.textContent));
      const data = dt.rows().data().toArray();
      if (!data.length) return null;
      // لو العناصر Arrays: حوّلها لكائنات حسب رؤوس الأعمدة
      return data.map((row) => {
        if (Array.isArray(row)) { const o = {}; heads.forEach((h, i) => { o[h] = row[i]; }); return o; }
        return row;
      });
    } catch (e) { return null; }
  }

  async function searchAndRead(input, cabin) {
    setNgValue(input, cabin);
    await sleep(400);
    const marker = captures.length;
    const searchBtn = findSearchButton(input);
    if (searchBtn) { logln("🔍 ضغط Search لـ " + cabin); clickEl(searchBtn); }
    else { logln("⚠️ لم أجد زر Search — أُرسل Enter."); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); }
    // انتظر التقاط شبكة جديد، أو ظهور صفوف بالجدول، أو رسالة «لا بيانات»
    const end = Date.now() + SEARCH_WAIT_MS;
    while (Date.now() < end) {
      if (captures.length > marker) {
        // خذ آخر التقاط
        return captures[captures.length - 1].rows;
      }
      const scraped = scrapeDataTable();
      if (scraped && scraped.length) return scraped;
      if (/no\s*data|no\s*matching|0\s*entries|no\s*record/i.test((document.body.innerText || ""))) return [];
      await sleep(400);
    }
    return null; // timeout
  }

  /* ================== التشغيل الرئيسى ================== */
  let running = false;
  async function run() {
    if (running) return; running = true;
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

      for (let i = 0; i < cabins.length; i++) {
        const cabin = cabins[i];
        banner("⏳ (" + (i + 1) + "/" + cabins.length + ") أمسان " + cabin + " …", "#1565c0");
        const input = (await gotoGetMsan()) || input0;
        const rows = await searchAndRead(input, cabin);
        if (rows == null) { failCabins++; logln("⏱️ " + cabin + " — انتهت المهلة بدون بيانات."); await sleep(BETWEEN_CABINS_MS); continue; }
        if (!rows.length) { logln("• " + cabin + " — 0 صف."); okCabins++; await sleep(BETWEEN_CABINS_MS); continue; }
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
    } finally { running = false; }
  }

  // أظهر الشريط + الزر
  if (document.body) ui(); else window.addEventListener("DOMContentLoaded", ui);

  // تشغيل تلقائى لو اتفتحت الصفحة من زر Service-Flow (?sf_ports=1) — نستنى الـ SPA يجهز
  const AUTO = /[?&#]sf_ports=1\b/.test(location.href);
  if (AUTO) {
    banner("⚙️ فتح تلقائى — سيبدأ التحديث خلال ثوانٍ… (لو مابدأش دوس الزر)", "#5b2a86");
    waitFor(() => document.querySelector("input[type='password']") || !/#\/login/i.test(location.hash), 20000)
      .then(() => sleep(1500))
      .then(() => { if (startBtn) { startBtn.disabled = true; startBtn.style.background = "#9e9e9e"; startBtn.textContent = "⏳ جارٍ التحديث…"; } return run(); })
      .catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
  }

  // أدوات كونسول
  window.SF_PORTS_run = run;
  window.SF_PORTS_captures = () => captures;
})();
