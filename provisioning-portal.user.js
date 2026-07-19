// ==UserScript==
// @name         Provisioning Portal → Service-Flow (تحديث البورتات + غيّر البورت MSAN)
// @namespace    service-flow.provisioning
// @description  سكربت واحد لموقع Provisioning Portal (WE) — فيه تدفّقان مستقلان تماماً بماركرين مختلفين لمنع أى تعارض: (1) sf_ports = تحديث ملف البورتات (Get MSAN Data لكل أكواد الأمسان المخزّنة فى Service-Flow). (2) sf_msan = غيّر البورت (MSAN Replacement) لرقم واحد — يفتح صفحة MSAN Replacement، يملأ Old/New Cabin Code، يولّد ملف CSV بالرقم ويحقنه فى خانة الرفع، ويسيب الـ Submit ليك يدوياً (أأمن لأنه بيغيّر بيانات مشترك). كل تدفّق فى نافذة باسم مستقل فالـ sessionStorage منفصل ومفيش تداخل.
// @version      1.3.2
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
  const AUTO = (() => { try { return sessionStorage.getItem(AUTO_KEY) === "1"; } catch (e) { return false; } })();
  const MSAN = (() => { try { return JSON.parse(sessionStorage.getItem(MSAN_KEY) || "null"); } catch (e) { return null; } })();

  /* ================== CONFIG ================== */
  const USER = "mena.haleem";
  const PASS = "Mon_oskar364";
  const SF_API_BASE = "https://service-flow-menoskar42.replit.app"; // دومين Service-Flow
  const SF_TOKEN = "sf-dzs-138-ingest-2026";                        // = DZS_INGEST_TOKEN فى السيرفر
  const GET_MSAN_HASH = "#/subscriber-management/get-msan-data";
  const MSAN_REPL_HASH = "#/subscriber-management/msan-replacement";
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
    bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 12px;font:bold 13px Arial;color:#fff;background:#5b2a86;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    bar.textContent = MSAN ? "🔁 غيّر البورت (MSAN Replacement) — جاهز" : "⚙️ تحديث ملف البورتات — جاهز";
    // زر تشغيل يدوى (للبورتات فقط — MSAN بيشتغل تلقائى ويسيبك تراجع)
    if (!MSAN) {
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

  async function doLoginOnce() {
    const pass = await waitFor(() => document.querySelector("input[type='password']"), 15000);
    if (!pass) return !onLoginPage();
    const inputs = [...document.querySelectorAll("input")].filter(visible);
    const pIdx = inputs.indexOf(pass);
    const userInput = inputs.slice(0, pIdx).reverse().find((i) => !/password/i.test(i.type)) || inputs[0];
    if (userInput) { setNgValue(userInput, ""); setNgValue(userInput, USER); }
    setNgValue(pass, PASS);
    await sleep(400);
    const btn = findButtonByText(/^login$|تسجيل|دخول/i) || findButtonByText(/login/i);
    if (btn) btn.click();
    await waitFor(() => !onLoginPage(), 20000);
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
      return data.map((row) => {
        if (Array.isArray(row)) { const o = {}; heads.forEach((h, i) => { o[h] = row[i]; }); return o; }
        return row;
      });
    } catch (e) { return null; }
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
      if (captures.length > marker) return captures[captures.length - 1].rows;
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

  let msanRunning = false;
  async function runMsan() {
    if (msanRunning) return; msanRunning = true;
    try {
      const data = MSAN || {};
      if (!data.phone) { banner("❌ لا يوجد رقم للتغيير.", "#c62828"); return; }
      banner("🔁 غيّر البورت — رقم " + data.phone + " من " + data.old + " إلى " + data.new, "#00695c");
      await ensureLoggedIn();
      const ok = await gotoMsanReplacement();
      if (!ok) { banner("❌ تعذّر فتح صفحة MSAN Replacement.", "#c62828"); return; }
      const oldIn = document.querySelector("input[formcontrolname='oldMsanCode']");
      const newIn = document.querySelector("input[formcontrolname='newMsanCode']");
      const fileIn = document.querySelector("input.custom-file-input, input[type='file']");
      if (!oldIn || !newIn) { banner("❌ لم أجد حقول Old/New Cabin Code.", "#c62828"); return; }
      setNgValue(oldIn, data.old);
      setNgValue(newIn, data.new);
      logln("✏️ Old=" + data.old + " | New=" + data.new);
      let fileOk = false;
      if (fileIn) {
        fileOk = injectFile(fileIn, buildMsanFile(data));
        logln(fileOk ? ("📎 اتحقن الملف: " + data.area + "," + data.phone + "," + data.pt + "," + data.sp) : "⚠️ تعذّر حقن الملف — ارفعه يدوياً.");
      } else {
        logln("⚠️ لم أجد خانة رفع الملف — اضغط Upload File يدوياً.");
      }
      // ضغط Submit تلقائياً بعد ملء الفورم وحقن الملف (نستنّى شوية عشان Angular يعالج الملف/التحقّق).
      await sleep(1200);
      const submitBtn = findButtonByText(/^\s*submit\s*$|إرسال|تنفيذ/i);
      if (fileOk && submitBtn) {
        clickEl(submitBtn);
        banner("✅ اتملأ الفورم واتضغط Submit تلقائياً — راجع نتيجة البورتال.", "#2e7d32");
        logln("🚀 اتضغط Submit.");
      } else {
        banner("✅ اتملأ الفورم" + (fileOk ? "" : " (الملف يدوى)") + " — اضغط Submit بنفسك.", "#ef6c00");
        logln(submitBtn ? "" : "⚠️ مالقتش زر Submit — اضغطه يدوى.");
      }
    } finally {
      msanRunning = false;
      // ملحوظة: مابنمسحش MSAN_KEY هنا — لو الجلسة سقطت بعد Submit ورجّعتك للّوجين، السكربت بيعيد
      // تسجيل الدخول ويملأ الفورم تانى أوتوماتيك (مش محتاج تعيد العملية يدوى). البيانات بتتستبدل
      // تلقائياً أول ما تفتح «غيّر البورت» لرقم جديد من Service-Flow.
    }
  }

  /* ================== إظهار الواجهة + التشغيل التلقائى ================== */
  if (document.body) ui(); else window.addEventListener("DOMContentLoaded", ui);

  // MSAN له الأولوية فى نافذته (نافذة مستقلة فمفيش تصادم). لو مفيش MSAN → تدفّق البورتات.
  if (MSAN && !window.__sfMsanFired) {
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
  window.SF_PORTS_captures = () => captures;
})();
