// ==UserScript==
// @name         DZS Expresse Continuous Flow v10.2 (Service-Flow 138 sheet + auto-upload + 140-batch/400s)
// @description  Measures DZS, outputs CSV in شيت-138 column order, and auto-updates case_138 in Service-Flow. v10.2: يقيس على دفعات 140 خط، وبعد كل دفعة ينتظر 400 ثانية قبل بدء الدفعة التالية (يتجنّب حد الـ popups).
// @version      10.2.0
// @match        *://10.42.187.101:8080/expresse/*
// @connect      service-flow--menoskar42.replit.app
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "xceed_lob";
  const PASS = "xceed.lob@1234";
  const RESET_TOKEN = "3";

  // 🆕 رفع تلقائى لشيت 138 فى Service-Flow
  const SF_API_BASE   = "https://service-flow--menoskar42.replit.app"; // ← عدّليه لو الدومين اتغيّر
  const SF_INGEST_TOKEN = "sf-dzs-138-ingest-2026"; // ← لازم يطابق DZS_INGEST_TOKEN فى السيرفر
  const SF_AUTO_UPLOAD = true; // false لو عايزه CSV فقط من غير رفع تلقائى

  // 🆕 القياس على دفعات: 140 خط لكل دفعة، وبعد كل دفعة انتظار 400 ثانية قبل الدفعة التالية
  const DZS_BATCH_SIZE = 140;
  const DZS_BATCH_PAUSE_MS = 400 * 1000; // 400 ثانية

  const SF_ACCOUNTS_KEY = "DZS_SF_ACCOUNTS";
  const SF_META_KEY     = "DZS_SF_META";

  function readAccountsFromHash() {
    const m = location.hash.match(/sf_accounts=([^&]+)/);
    if (!m) return null;
    const arr = decodeURIComponent(m[1]).split(",").map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  // sf_meta = account~complaint~short~full ; ...
  function parseMetaFromHash() {
    const m = location.hash.match(/sf_meta=([^&]+)/);
    if (!m) return null;
    const map = {};
    decodeURIComponent(m[1]).split(";").forEach(rec => {
      if (!rec) return;
      const [account, complaint, short, full] = rec.split("~");
      if (account) map[account.trim()] = { complaint: complaint || "", short: short || "", full: full || "" };
    });
    return Object.keys(map).length ? map : null;
  }

  let LINE_IDS;
  const _fromHash = readAccountsFromHash();
  if (_fromHash) {
    LINE_IDS = _fromHash;
    console.log("🔗 " + _fromHash.length + " account(s) loaded from Service-Flow.");
  } else {
    const _stored = JSON.parse(localStorage.getItem(SF_ACCOUNTS_KEY) || "null");
    LINE_IDS = (_stored && _stored.length)
      ? _stored
      : ["6973996","156045505","2655144","80457285","62659859","77303415"]; // fallback يدوى
  }

  // خريطة بيانات كل أكونت (شكوى/تليفون) — من الـ hash أو localStorage
  let SF_META = parseMetaFromHash() || JSON.parse(localStorage.getItem(SF_META_KEY) || "{}");

  const UNIQUE_LINE_COUNT = new Set(LINE_IDS).size;

  const WAIT_FOR_DISPATCH_SCORE = 1.9 * 60 * 1000;
  const EARLY_READ_MAX_MS = 40 * 1000;
  const STAGGER_BETWEEN_TABS_MS = 5000;
  const POPUP_RETRY_DELAY_MS = 10000;
  const MAX_POPUP_ATTEMPTS = 5;
  const DELAY_BEFORE_CLOSE_MS = 2000;
  const MAX_LINE_DETAILS_WAIT_MS = 2 * 60 * 1000;
  const MAX_REAL_TIME_WAIT_MS = 90 * 1000;
  const MAX_CONFIRM_WAIT_MS = 60 * 1000;

  const SCORE_OUT_OF_SERVICE = "101";
  const SCORE_NO_FIELD = "102";
  const SCORE_NOT_PROVISIONED = "103";
  const SCORE_TIMEOUT = "104";

  /* ================== STORAGE KEYS ================== */
  const INDEX_KEY = "DZS_LINE_INDEX";
  const ARRAY_KEY = "DZS_LINE_ARRAY_HASH";
  const RESULTS_KEY = "DZS_RESULTS";
  const DOWNLOAD_DONE_KEY = "DZS_DOWNLOAD_DONE";
  const RESET_TOKEN_KEY = "DZS_RESET_TOKEN";

  /* ================== FORCED RESET via TOKEN ================== */
  const savedToken = localStorage.getItem(RESET_TOKEN_KEY);
  if (savedToken !== RESET_TOKEN) {
    Object.keys(localStorage).filter(k => k.indexOf("DZS_") === 0).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(RESET_TOKEN_KEY, RESET_TOKEN);
    console.log("🧹 FORCED RESET via token '" + RESET_TOKEN + "'.");
  }

  /* ================== AUTO-DETECT COMPLETED RUN ================== */
  const prevDownloadDone = localStorage.getItem(DOWNLOAD_DONE_KEY) === "1";
  const prevResults = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
  const prevRunComplete = prevDownloadDone || (prevResults.length >= UNIQUE_LINE_COUNT && prevResults.length > 0);
  if (prevRunComplete) {
    Object.keys(localStorage).filter(k => k.indexOf("DZS_") === 0).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(RESET_TOKEN_KEY, RESET_TOKEN);
    console.log("🔄 Previous run complete, auto-reset.");
  }

  /* ================== ARRAY CHANGE / RESET ================== */
  const currentArrayHash = LINE_IDS.join("|");
  const savedArrayHash = localStorage.getItem(ARRAY_KEY);
  if (savedArrayHash !== currentArrayHash) {
    localStorage.setItem(INDEX_KEY, "0");
    localStorage.setItem(ARRAY_KEY, currentArrayHash);
    localStorage.removeItem(RESULTS_KEY);
    localStorage.removeItem(DOWNLOAD_DONE_KEY);
    console.log("🔄 List changed, reset to index 0");
  }

  // ثبّت القايمة + الميتا بعد كل منطق الـ reset عشان التابات اللى بعد كده تقراهم.
  localStorage.setItem(SF_ACCOUNTS_KEY, JSON.stringify(LINE_IDS));
  localStorage.setItem(SF_META_KEY, JSON.stringify(SF_META));

  let lineIndex = parseInt(localStorage.getItem(INDEX_KEY), 10);
  if (isNaN(lineIndex) || lineIndex < 0) lineIndex = 0;
  if (lineIndex >= LINE_IDS.length) {
    lineIndex = 0; localStorage.setItem(INDEX_KEY, "0");
    localStorage.removeItem(RESULTS_KEY); localStorage.removeItem(DOWNLOAD_DONE_KEY);
  }

  const currentResults = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
  while (lineIndex < LINE_IDS.length) {
    const cur = LINE_IDS[lineIndex];
    if (!currentResults.some(r => r.lineId === cur)) break;
    lineIndex++; localStorage.setItem(INDEX_KEY, String(lineIndex));
  }

  let allDone = false;
  if (lineIndex >= LINE_IDS.length) { allDone = true; console.log("✅ All lines measured."); }

  const CURRENT_LINE_ID = allDone ? null : LINE_IDS[lineIndex];

  let lineDetailsDone = false, yesClicked = false, processingComplete = false, iAmTheDownloader = false;
  let iAmBatchLauncher = false; // 🆕 هذا التاب مسؤول عن إطلاق الدفعة التالية بعد انتظار 400 ثانية
  let earlyScore = "", earlyCur = "", earlyMax = "";

  /* ================== HELPERS ================== */
  const isBadReading = (v) => !v || /^n\/?a$/i.test(String(v).trim());

  function getMeta(lineId) {
    const m = SF_META[lineId] || JSON.parse(localStorage.getItem(SF_META_KEY) || "{}")[lineId] || {};
    const short = m.short || "";
    const full = m.full || (short ? "88" + short : "");
    return { complaint: m.complaint || "", short, full };
  }

  function checkForKnownState() {
    const t = (document.body.innerText || "").toLowerCase();
    if (t.includes("line is no longer provisioned")) return SCORE_NOT_PROVISIONED;
    if (t.includes("line is out of service")) return SCORE_OUT_OF_SERVICE;
    return null;
  }

  function findLineDetailsLink() {
    let link = document.querySelector("#dsl\\:detailLinkForm\\:lineDetailLink");
    if (link) return link;
    link = document.querySelector("[id$=':lineDetailLink'], [id$='lineDetailLink']");
    if (link) return link;
    link = document.querySelector("[id*='lineDetailLink']");
    if (link) return link;
    for (const el of document.querySelectorAll("a, button, span[onclick], div[onclick]"))
      if (el.textContent.trim().toLowerCase() === "line details") return el;
    return null;
  }
  function findRealTimeButton() {
    const byTitle = [...document.querySelectorAll("[title]")].find(el => el.title.toLowerCase().includes("real-time"));
    if (byTitle) return byTitle;
    for (const el of document.querySelectorAll("a, button, span[onclick], img[onclick]")) {
      const t = el.textContent.trim().toLowerCase();
      if (t.includes("real-time analysis") || t === "real-time") return el;
    }
    return null;
  }

  function findValueCellByLabel(labelText) {
    let candidates = [...document.querySelectorAll("*")].filter(el => el.children.length === 0 && el.textContent.trim() === labelText);
    if (candidates.length === 0)
      candidates = [...document.querySelectorAll("*")].filter(el => el.children.length === 0 && el.textContent.trim().replace(/\s+/g, " ") === labelText);
    for (const labelEl of candidates) {
      const tr = labelEl.closest("tr");
      if (tr) {
        const cells = [...tr.children];
        const idx = cells.findIndex(c => c === labelEl || c.contains(labelEl));
        for (let i = idx + 1; i < cells.length; i++) { const t = cells[i].textContent.trim(); if (t) return t; }
      }
      if (labelEl.tagName === "DT") { const dd = labelEl.nextElementSibling; if (dd && dd.tagName === "DD") return dd.textContent.trim(); }
      let cur = labelEl;
      for (let d = 0; d < 5; d++) {
        const parent = cur.parentElement; if (!parent) break;
        const next = parent.nextElementSibling;
        if (next) { const t = next.textContent.trim(); if (t && t !== labelText) return t; }
        cur = parent;
      }
    }
    return "";
  }
  function extractDS(cellText) {
    if (!cellText) return "";
    const m = cellText.match(/DS\s*=\s*([\d.]+|N\/?A)/i);
    if (!m) return "";
    return /^n\/?a$/i.test(m[1]) ? "N/A" : m[1];
  }
  function findSynchRateDS() { return extractDS(findValueCellByLabel("Synch Rate")); }
  function findMaxAchievableDS() {
    let v = extractDS(findValueCellByLabel("Max. Achievable Bit Rate"));
    if (!v) v = extractDS(findValueCellByLabel("Max Achievable Bit Rate"));
    return v;
  }
  function findDispatchScore() {
    const ks = checkForKnownState(); if (ks !== null) return ks;
    const labelText = "Dispatch Score";
    const candidates = [...document.querySelectorAll("*")].filter(el => el.children.length === 0 && el.textContent.trim() === labelText);
    if (candidates.length === 0) return SCORE_NO_FIELD;
    for (const labelEl of candidates) {
      const tr = labelEl.closest("tr");
      if (tr) {
        const cells = [...tr.children];
        const idx = cells.findIndex(c => c === labelEl || c.contains(labelEl));
        for (let i = idx + 1; i < cells.length; i++) { const t = cells[i].textContent.trim(); if (t) return t; }
      }
      if (labelEl.tagName === "DT") { const dd = labelEl.nextElementSibling; if (dd && dd.tagName === "DD") return dd.textContent.trim(); }
      let cur = labelEl;
      for (let d = 0; d < 5; d++) {
        const parent = cur.parentElement; if (!parent) break;
        const next = parent.nextElementSibling;
        if (next) { const t = next.textContent.trim(); if (t && t !== labelText) return t; }
        cur = parent;
      }
    }
    return SCORE_NO_FIELD;
  }
  function captureEarly() {
    const c = findSynchRateDS(), m = findMaxAchievableDS(), s = findDispatchScore();
    if (!isBadReading(c)) earlyCur = c;
    if (!isBadReading(m)) earlyMax = m;
    if (!isBadReading(s)) earlyScore = s;
    return !isBadReading(earlyCur) || !isBadReading(earlyMax);
  }

  // 🆕 رفع نتيجة لشيت 138 فى Service-Flow
  function postToServiceFlow(rec) {
    if (!SF_AUTO_UPLOAD || !SF_API_BASE) return;
    try {
      fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/case-138/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DZS-Token": SF_INGEST_TOKEN },
        body: JSON.stringify({ items: [{
          phoneShort: rec.phoneShort, complainNo: rec.complainNo, score: rec.dispatchScore,
          currentSpeed: rec.currentSpeed, maxSpeed: rec.maxSpeed, fullPhone: rec.fullPhone, accountNo: rec.accountNo,
        }] }),
      }).then(r => r.json()).then(j => console.log("☁️ 138 updated:", rec.accountNo, j))
        .catch(e => console.warn("☁️ 138 update failed:", e));
    } catch (e) { console.warn("post err", e); }
  }

  function saveResult(lineId, score, currentSpeed, maxSpeed, source) {
    const results = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
    if (results.some(r => r.lineId === lineId)) return;
    const meta = getMeta(lineId);
    const rec = {
      lineId, accountNo: lineId,
      complainNo: meta.complaint, phoneShort: meta.short, fullPhone: meta.full,
      dispatchScore: score, currentSpeed: currentSpeed || "", maxSpeed: maxSpeed || "",
      readingSource: source || "بعد", timestamp: new Date().toISOString(),
    };
    results.push(rec);
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
    console.log("💾 Saved:", lineId, "score:", score, "cur:", currentSpeed || "-", "max:", maxSpeed || "-",
                "| phone:", meta.short || "-", "| complaint:", meta.complaint || "-",
                "(" + results.length + "/" + UNIQUE_LINE_COUNT + ")");
    updateDownloadButton();
    postToServiceFlow(rec);
  }

  // CSV بترتيب شيت 138
  function downloadResults() {
    const results = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
    if (!results.length) { alert("لا توجد نتائج للتنزيل حتى الآن."); return false; }
    const SEP = ";";
    const header = ["رقم التلفون","رقم الشكوي","score","السرعه الحاليه","اقصى سرعه","رقم التليفون كاملا","رقم الاكونت","القراية (قبل/بعد)"].join(SEP);
    const rows = results.map(r => [
      r.phoneShort || "", r.complainNo || "", r.dispatchScore || "", r.currentSpeed || "", r.maxSpeed || "",
      r.fullPhone || "", r.accountNo || r.lineId || "", r.readingSource || "",
    ].join(SEP)).join("\n");
    const csv = "﻿" + header + "\n" + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dzs_138_${new Date().toISOString().slice(0,10).replace(/-/g,"")}_${results.length}rows.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    console.log("📥 Downloaded CSV with", results.length, "rows");
    return true;
  }

  function closeThisTab() {
    if (iAmTheDownloader) { console.log("🔒 Tab kept open for CSV."); showFinalMessage(); return; }
    // 🆕 لو هذا التاب مسؤول عن إطلاق الدفعة التالية، نبقيه مفتوحاً حتى يُطلقها (بعد 400 ثانية) ثم يغلق نفسه
    if (iAmBatchLauncher) { console.log("🔒 تاب مُطلِق الدفعة — يبقى مفتوحاً حتى تبدأ الدفعة التالية بعد 400 ثانية."); return; }
    setTimeout(() => { window.close(); }, DELAY_BEFORE_CLOSE_MS);
  }
  function showFinalMessage() {
    try {
      const b = document.createElement("div");
      b.style.cssText = "position:fixed;top:0;left:0;right:0;background:#2e7d32;color:#fff;padding:20px;font:bold 18px Arial;text-align:center;z-index:999999";
      b.innerHTML = "✅ تم قياس كل الخطوط وتحديث شيت 138 وحفظ CSV. تقدر تقفل التاب.";
      document.body.appendChild(b);
    } catch (e) {}
  }

  /* ============ FLOATING DOWNLOAD BUTTON ============ */
  function injectDownloadButton() {
    if (document.getElementById("dzs-download-btn")) return;
    const btn = document.createElement("div");
    btn.id = "dzs-download-btn";
    btn.style.cssText = "position:fixed;bottom:20px;right:20px;background:#1976d2;color:#fff;padding:14px 20px;border-radius:8px;font:bold 15px Arial;cursor:pointer;z-index:999998;box-shadow:0 4px 12px rgba(0,0,0,.3)";
    btn.onclick = () => {
      const results = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
      if (!results.length) { alert("⚠️ لا توجد نتائج بعد."); return; }
      if (confirm("تنزيل CSV بـ " + results.length + " نتيجة؟")) { localStorage.removeItem(DOWNLOAD_DONE_KEY); downloadResults(); }
    };
    document.body.appendChild(btn);
    updateDownloadButton();
  }
  function updateDownloadButton() {
    const btn = document.getElementById("dzs-download-btn"); if (!btn) return;
    const results = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
    const pct = Math.round((results.length / UNIQUE_LINE_COUNT) * 100);
    btn.innerHTML = "📥 تنزيل CSV (" + results.length + "/" + UNIQUE_LINE_COUNT + " — " + pct + "%)";
    if (results.length >= UNIQUE_LINE_COUNT) btn.style.background = "#2e7d32";
  }
  (function ensureButton(){ document.body ? injectDownloadButton() : setTimeout(ensureButton,200); })();
  setInterval(updateDownloadButton, 5000);

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
      e.preventDefault(); localStorage.removeItem(DOWNLOAD_DONE_KEY); downloadResults();
    }
  });

  function openNextLine() {
    const nextIndex = lineIndex + 1;
    if (nextIndex >= LINE_IDS.length) { console.log("🏁 No more lines."); return; }
    localStorage.setItem(INDEX_KEY, String(nextIndex));

    // 🆕 لو وصلنا حدّ دفعة (كل 50 خط) → استنى 400 ثانية قبل بدء الدفعة التالية،
    //    وخلّى هذا التاب مفتوحاً (launcher) حتى يُطلقها فعلاً ثم يغلق نفسه.
    const crossingBatch = (nextIndex % DZS_BATCH_SIZE === 0);
    const delay = crossingBatch ? DZS_BATCH_PAUSE_MS : STAGGER_BETWEEN_TABS_MS;
    if (crossingBatch) {
      iAmBatchLauncher = true;
      console.log("⏸️ نهاية دفعة " + DZS_BATCH_SIZE + " — استنى " + (DZS_BATCH_PAUSE_MS / 1000) +
                  " ثانية ثم نبدأ الدفعة التالية من خط رقم " + nextIndex);
    }

    const tryOpen = (n) => {
      const features = "width=1280,height=800,left=" + (50 + ((nextIndex*40)%400)) + ",top=" + (50 + ((nextIndex*40)%200));
      const w = window.open("/expresse/welcome", "_blank", features);
      const opened = (w && !w.closed);
      if (!opened && n < MAX_POPUP_ATTEMPTS) { setTimeout(() => tryOpen(n+1), POPUP_RETRY_DELAY_MS); return; }
      // أُطلقت الدفعة التالية (أو استُنفدت المحاولات) — اسمح لهذا التاب بالإغلاق
      if (crossingBatch) {
        if (opened) console.log("▶️ بدأت الدفعة التالية من خط رقم " + nextIndex);
        iAmBatchLauncher = false;
        setTimeout(() => { try { window.close(); } catch (e) {} }, DELAY_BEFORE_CLOSE_MS);
      }
    };
    setTimeout(() => tryOpen(1), delay);
  }

  function maybeDownloadFinal() {
    const results = JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]");
    if (results.length < UNIQUE_LINE_COUNT) return;
    if (localStorage.getItem(DOWNLOAD_DONE_KEY) === "1") return;
    localStorage.setItem(DOWNLOAD_DONE_KEY, "1");
    iAmTheDownloader = true;
    setTimeout(() => { downloadResults(); }, 1500);
  }

  function readScoreThenClose() {
    if (processingComplete) return;
    processingComplete = true;
    const finalScore = findDispatchScore(), finalCur = findSynchRateDS(), finalMax = findMaxAchievableDS();
    let cur = finalCur, max = finalMax, usedEarly = false;
    if (isBadReading(cur) && !isBadReading(earlyCur)) { cur = earlyCur; usedEarly = true; }
    if (isBadReading(max) && !isBadReading(earlyMax)) { max = earlyMax; usedEarly = true; }
    let score = finalScore;
    if (isBadReading(score) && !isBadReading(earlyScore)) score = earlyScore;
    saveResult(CURRENT_LINE_ID, score, cur, max, usedEarly ? "قبل" : "بعد");
    maybeDownloadFinal();
    closeThisTab();
  }
  function handleSpecialAndClose(score) {
    if (processingComplete) return;
    processingComplete = true;
    saveResult(CURRENT_LINE_ID, score, "", "", "-");
    openNextLine(); maybeDownloadFinal(); closeThisTab();
  }

  window.DZS_test = findDispatchScore;
  window.DZS_synch = findSynchRateDS;
  window.DZS_maxbr = findMaxAchievableDS;
  window.DZS_showResults = () => console.table(JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]"));
  window.DZS_clearResults = () => { Object.keys(localStorage).filter(k=>k.indexOf("DZS_")===0).forEach(k=>localStorage.removeItem(k)); location.reload(); };
  window.DZS_forceDownload = () => { localStorage.removeItem(DOWNLOAD_DONE_KEY); return downloadResults(); };

  if (allDone) return;

  /* ===== GLOBAL WATCHDOG ===== */
  setTimeout(function globalWatchdog() {
    if (processingComplete) return;
    console.warn("⏱️ Watchdog finalize for " + CURRENT_LINE_ID);
    if (!yesClicked) openNextLine();
    readScoreThenClose();
  }, WAIT_FOR_DISPATCH_SCORE + 60 * 1000);

  /* ================== AUTO LOGIN ================== */
  const loginTimer = setInterval(() => {
    if (processingComplete) { clearInterval(loginTimer); return; }
    const u = document.querySelector("#j_username"), p = document.querySelector("#j_password"), b = document.querySelector("button.ui-button, button");
    if (!u || !p || !b) return;
    u.value = USER; p.value = PASS; b.click(); clearInterval(loginTimer);
  }, 500);

  /* ================== OPEN CLEARVIEW ================== */
  const clearViewTimer = setInterval(() => {
    if (processingComplete) { clearInterval(clearViewTimer); return; }
    if (!location.href.includes("/expresse/welcome")) return;
    location.href = "/expresse/clearview?lineId=" + CURRENT_LINE_ID;
    clearInterval(clearViewTimer);
  }, 500);

  /* ================== LINE DETAILS ================== */
  const POLL_LD = 600, MAX_LD = Math.ceil(MAX_LINE_DETAILS_WAIT_MS / POLL_LD); let ld = 0;
  const lineDetailsTimer = setInterval(() => {
    if (processingComplete) { clearInterval(lineDetailsTimer); return; }
    if (lineDetailsDone) return;
    if (!location.href.includes("/expresse/clearview")) return;
    ld++;
    const ks = checkForKnownState(); if (ks !== null) { clearInterval(lineDetailsTimer); handleSpecialAndClose(ks); return; }
    const link = findLineDetailsLink();
    if (link) { link.scrollIntoView({block:"center"}); link.click(); lineDetailsDone = true; clearInterval(lineDetailsTimer); return; }
    if (findRealTimeButton()) { lineDetailsDone = true; clearInterval(lineDetailsTimer); return; }
    if (ld >= MAX_LD) { clearInterval(lineDetailsTimer); handleSpecialAndClose(SCORE_TIMEOUT); }
  }, POLL_LD);

  /* ================== REAL TIME ================== */
  const POLL_RT = 800, MAX_RT = Math.ceil(MAX_REAL_TIME_WAIT_MS / POLL_RT); let rt = 0;
  const realTimeTimer = setInterval(() => {
    if (processingComplete) { clearInterval(realTimeTimer); return; }
    if (!lineDetailsDone) return;
    rt++;
    const ks = checkForKnownState(); if (ks !== null) { clearInterval(realTimeTimer); handleSpecialAndClose(ks); return; }
    const b = findRealTimeButton();
    if (b) { b.click(); clearInterval(realTimeTimer); return; }
    if (rt >= MAX_RT) { clearInterval(realTimeTimer); handleSpecialAndClose(SCORE_TIMEOUT); }
  }, POLL_RT);

  /* ================== YES → early + final ================== */
  const POLL_CF = 800, MAX_CF = Math.ceil(MAX_CONFIRM_WAIT_MS / POLL_CF); let cf = 0;
  const confirmTimer = setInterval(() => {
    if (processingComplete) { clearInterval(confirmTimer); return; }
    if (yesClicked) { clearInterval(confirmTimer); return; }
    cf++;
    const dialog = document.querySelector("div[id*='rtDialog']");
    if (!(dialog && dialog.style.display !== "none")) { if (cf >= MAX_CF) { clearInterval(confirmTimer); handleSpecialAndClose(SCORE_TIMEOUT); } return; }
    const yesBtn = document.querySelector("button[id*='confirmationForm:yesButton']");
    if (!yesBtn) return;
    yesBtn.click(); yesClicked = true; clearInterval(confirmTimer);
    openNextLine();
    const t0 = Date.now();
    const earlyTimer = setInterval(() => {
      if (processingComplete) { clearInterval(earlyTimer); return; }
      if (captureEarly()) { clearInterval(earlyTimer); return; }
      if (Date.now() - t0 >= EARLY_READ_MAX_MS) clearInterval(earlyTimer);
    }, 3000);
    setTimeout(() => readScoreThenClose(), WAIT_FOR_DISPATCH_SCORE);
  }, POLL_CF);

})();
