// ==UserScript==
// @name         DZS Expresse Continuous Flow v10.7 (Service-Flow 138 sheet + auto-upload)
// @description  Measures DZS, outputs CSV in شيت-138 column order, and auto-updates case_138 in Service-Flow. v10.7: إعادة محاولة تلقائية لطلب الـ real-time لو سيرفر AXON رجّع "Request timed-out while in the Resource Allocator queue / data collection issue" (لحد MAX_RT_ATTEMPTS مرات) — الخط سليم لكن السيرفر زحم، فبدل ما نسجّل قراية غلط نعيد الطلب؛ والـ watchdog بقى retry-aware. v10.6: حد أقصى لعدد التابات المتزامنة (MAX_CONCURRENT=5) يمنع امتلاء الذاكرة.
// @version      10.7.2
// @match        *://10.42.187.101:8080/expresse/*
// @connect      service-flow--menoskar42.replit.app
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ===== AUTO-REFRESH صفحة "Out of Memory" ===== */
  // لو المتصفح طلع "Not enough memory to open this page" نعمل reload أوتوماتيك بدل اليدوى.
  (function autoRefreshOOM() {
    const txt = (document.body && document.body.innerText || "");
    if (/not enough memory|out of memory/i.test(txt)) {
      console.warn("🧠 Out of Memory page — auto refreshing…");
      setTimeout(() => { try { location.reload(); } catch (e) {} }, 2000);
    }
  })();

  /* ===== تتبّع عدد التابات المفتوحة (heartbeat فى localStorage) ===== */
  const OPEN_TABS_KEY = "DZS_OPEN_TABS";
  const MY_TAB_ID = "t" + Math.random().toString(36).slice(2) + "_" + new Date().getTime();
  function heartbeat() {
    try {
      const m = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) || "{}");
      const now = new Date().getTime();
      m[MY_TAB_ID] = now;
      for (const k in m) if (now - m[k] > 8000) delete m[k]; // نظّف القديمة
      localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  function countOpenTabs() {
    try {
      const m = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) || "{}");
      const now = new Date().getTime();
      return Object.keys(m).filter(k => now - m[k] < 8000).length;
    } catch (e) { return 0; }
  }
  function removeMyTab() {
    try {
      const m = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) || "{}");
      delete m[MY_TAB_ID];
      localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  heartbeat();
  setInterval(heartbeat, 2000);
  window.addEventListener("beforeunload", removeMyTab);
  window.addEventListener("unload", removeMyTab);

  /* ================== CONFIG ================== */
  const USER = "xceed_lob";
  const PASS = "xceed.lob@1234";
  const RESET_TOKEN = "3";

  // 🆕 رفع تلقائى لشيت 138 فى Service-Flow
  const SF_API_BASE   = "https://service-flow--menoskar42.replit.app"; // ← عدّليه لو الدومين اتغيّر
  const SF_INGEST_TOKEN = "sf-dzs-138-ingest-2026"; // ← لازم يطابق DZS_INGEST_TOKEN فى السيرفر
  const SF_AUTO_UPLOAD = true; // false لو عايزه CSV فقط من غير رفع تلقائى

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

  const WAIT_FOR_DISPATCH_SCORE = 1.6 * 60 * 1000; // وقت انتظار الـ Dispatch Score بعد yes — قلّليه يسرّع لكن لو زاد عدد القراءات الفاضية/102 ارجعيه لـ 1.8
  const EARLY_READ_MAX_MS = 40 * 1000;
  const STAGGER_BETWEEN_TABS_MS = 5000;
  const MAX_CONCURRENT = 2; // AXON يسمح بـ real-time واحد لكل جلسة دخول، فالتوازي العالي بيعمل تصادمات
                            // ("another real-time request in progress" / "Resource Allocator queue timed out").
                            // ابدأ بـ 2؛ لو لسه الرسالة بتظهر كتير نزّلها لـ 1.
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
  const SCORE_NOT_FOUND = "105"; // 🆕 line id not found → score 105 وسرعات فاضية

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
    const raw = document.body.innerText || "";
    const t = raw.toLowerCase();
    // 103 — أوسع تطابق: "no longer provisioned/provisional/provision" أو "Not Provisioned"
    if (/no\s*longer\s*provision|not\s*provision/i.test(raw)) return SCORE_NOT_PROVISIONED;
    if (t.includes("line is out of service")) return SCORE_OUT_OF_SERVICE;          // 101
    // "line id not found" (أو صيغ مشابهة) → score 105 وسرعات فاضية، تتعالج فوراً بدون انتظار timeout
    if (/line\s*id\s*not\s*found|line\s*not\s*found|id\s*not\s*found|no\s*such\s*line/i.test(raw)) return SCORE_NOT_FOUND;
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
    removeMyTab();
    setTimeout(() => {
      // المتصفح بيرفض window.close() على التابات اللى اتنقّلت (welcome→clearview)؛
      // نعمل reset للنافذة الأول عشان يسمح بالإغلاق (حيلة معروفة) ثم نقفل.
      try { window.open("", "_self"); } catch (e) {}
      try { window.close(); } catch (e) {}
      try { window.top.close(); } catch (e) {}
    }, DELAY_BEFORE_CLOSE_MS);
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
    btn.innerHTML = "📥 تنزيل CSV (" + results.length + "/" + UNIQUE_LINE_COUNT + " — " + pct + "%)"
                  + "<br><span style='font-size:12px;font-weight:normal'>🗂️ " + countOpenTabs() + " تاب مفتوح</span>";
    if (results.length >= UNIQUE_LINE_COUNT) btn.style.background = "#2e7d32";
  }
  (function ensureButton(){ document.body ? injectDownloadButton() : setTimeout(ensureButton,200); })();
  setInterval(updateDownloadButton, 5000);

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
      e.preventDefault(); localStorage.removeItem(DOWNLOAD_DONE_KEY); downloadResults();
    }
  });

  // يفتح الخط التالى مع احترام حد التابات المتزامنة (MAX_CONCURRENT) — يمنع امتلاء الذاكرة
  // وتعارضات الـ real-time. cb (اختيارى) تتنفّذ بعد ما يفتح فعلاً (تُستخدم لقفل التاب الحالى بعد الفتح).
  function openNextLine(cb) {
    const nextIndex = lineIndex + 1;
    if (nextIndex >= LINE_IDS.length) { console.log("🏁 No more lines."); if (cb) cb(); return; }
    const attempt = () => {
      // مزدحم؟ استنى لحد ما يقفل تاب قبل ما نفتح التالى (يمنع flood الذاكرة)
      if (countOpenTabs() > MAX_CONCURRENT) { setTimeout(attempt, 1500); return; }
      localStorage.setItem(INDEX_KEY, String(nextIndex));
      const features = "width=1280,height=800,left=" + (50 + ((nextIndex*40)%400)) + ",top=" + (50 + ((nextIndex*40)%200));
      const w = window.open("/expresse/welcome", "_blank", features);
      if (!(w && !w.closed)) { setTimeout(attempt, POPUP_RETRY_DELAY_MS); return; } // popup فشل — أعد
      if (cb) cb();
    };
    setTimeout(attempt, STAGGER_BETWEEN_TABS_MS);
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
    maybeDownloadFinal();
    if (iAmTheDownloader) { showFinalMessage(); return; } // آخر خط — يفضل مفتوح للـ CSV
    openNextLine(closeThisTab); // افتح التالى (مع احترام الحد) ثم اقفل التاب ده — متتكسرش السلسلة ومتفيضش الذاكرة
  }

  window.DZS_test = findDispatchScore;
  window.DZS_synch = findSynchRateDS;
  window.DZS_maxbr = findMaxAchievableDS;
  window.DZS_showResults = () => console.table(JSON.parse(localStorage.getItem(RESULTS_KEY) || "[]"));
  window.DZS_clearResults = () => { Object.keys(localStorage).filter(k=>k.indexOf("DZS_")===0).forEach(k=>localStorage.removeItem(k)); location.reload(); };
  window.DZS_forceDownload = () => { localStorage.removeItem(DOWNLOAD_DONE_KEY); return downloadResults(); };

  if (allDone) return;

  /* ===== RETRY على فشل الـ Resource Allocator (سيرفر AXON مزحوم) =====
     رسالة "Request timed-out while in the Resource Allocator queue" أو
     "problem exists with the collected data / data collection issue" معناها إن سيرفر AXON
     زحم وفشل يجمّع بيانات الـ real-time — والخط نفسه سليم (Provisioned). بدل ما نسجّل قراية
     غلط (102) لخط سليم، نعيد طلب الـ real-time لحد MAX_RT_ATTEMPTS مرات؛ لو فشل كله نسجّل 104. */
  const POLL_CF = 800, MAX_CF = Math.ceil(MAX_CONFIRM_WAIT_MS / POLL_CF);
  const MAX_RT_ATTEMPTS = 3;                  // عدد محاولات الـ real-time قبل ما نستسلم
  const RESOURCE_WATCH_DELAY_MS = 30 * 1000;  // نبدأ نراقب فشل الـ Resource Allocator بعد 30ث من yes (نسيب الطلب يخلص)
  const RA_BUSY_RE = /another\s*real-?time\s*request\s*is\s*in\s*progress|real-?time\s*request\s*currently\s*unavailable/i;
  const RA_FAIL_RE = /timed-?out\s*while\s*in\s*the\s*resource\s*allocator\s*queue|problem\s*exists\s*with\s*the\s*collected\s*data|data\s*collection\s*issue|no\s*action\s*can\s*be\s*recommended/i;
  let rtAttempt = 0, watchdogFires = 0, nextLineOpened = false, finalReadTimer = null, resourceWatcher = null;

  // بعد ضغط yes: افتح التالى (مرة واحدة) + اقرأ بدرى + جدول القراية النهائية بعد 1.9 دقيقة.
  function afterYesClicked() {
    if (!nextLineOpened) { nextLineOpened = true; openNextLine(); }
    const t0 = Date.now();
    const earlyTimer = setInterval(() => {
      if (processingComplete) { clearInterval(earlyTimer); return; }
      if (captureEarly()) { clearInterval(earlyTimer); return; }
      if (Date.now() - t0 >= EARLY_READ_MAX_MS) clearInterval(earlyTimer);
    }, 3000);
    if (finalReadTimer) clearTimeout(finalReadTimer);
    finalReadTimer = setTimeout(() => readScoreThenClose(), WAIT_FOR_DISPATCH_SCORE);
  }

  // يراقب ظهور فشل الـ Resource Allocator بعد yes — لو ظهر وفيه محاولات متبقّية يعيد طلب الـ real-time.
  function startResourceWatcher() {
    if (resourceWatcher) clearInterval(resourceWatcher);
    const startedAt = Date.now();
    resourceWatcher = setInterval(() => {
      if (processingComplete) { clearInterval(resourceWatcher); return; }
      if (Date.now() - startedAt < RESOURCE_WATCH_DELAY_MS) return; // اسيب الطلب يجري الأول
      if (!RA_FAIL_RE.test(document.body.innerText || "")) return;
      // ظهر فشل الـ Resource Allocator
      clearInterval(resourceWatcher);
      if (finalReadTimer) { clearTimeout(finalReadTimer); finalReadTimer = null; }
      if (rtAttempt < MAX_RT_ATTEMPTS) {
        rtAttempt++;
        console.warn("♻️ Resource Allocator timeout — إعادة محاولة " + rtAttempt + "/" + MAX_RT_ATTEMPTS + " للخط " + CURRENT_LINE_ID);
        const rb = findRealTimeButton(); if (rb) rb.click();
        yesClicked = false;
        armConfirm(); // استنى الـ dialog تانى → yes → راقب من جديد
      } else {
        console.warn("⛔ الـ Resource Allocator فشل " + MAX_RT_ATTEMPTS + " مرات — تسجيل 104 للخط " + CURRENT_LINE_ID);
        handleSpecialAndClose(SCORE_TIMEOUT);
      }
    }, 2500);
  }

  // يستنى dialog التأكيد ويضغط yes (قابل لإعادة الاستدعاء فى كل محاولة retry).
  function armConfirm() {
    let cf = 0;
    const confirmTimer = setInterval(() => {
      if (processingComplete) { clearInterval(confirmTimer); return; }
      if (yesClicked) { clearInterval(confirmTimer); return; }
      cf++;
      const ks = checkForKnownState(); if (ks !== null) { clearInterval(confirmTimer); handleSpecialAndClose(ks); return; }
      // الـ real-time مشغول بطلب تانى → نعيد المحاولة ونستنى لحد ما يفضى (بدل فشل بـ timeout 60ث وتسجيل 104 غلط)
      if (RA_BUSY_RE.test(document.body.innerText || "")) {
        if (cf % 8 === 0) { const rb = findRealTimeButton(); if (rb) rb.click(); } // إعادة الطلب كل ~6 ثوانى
        if (cf < MAX_CF * 5) return; // استنى لحد ~5 دقايق لما يكون مشغول (تاب تانى ماسك الـ slot) قبل ما نستسلم
      }
      const dialog = document.querySelector("div[id*='rtDialog']");
      if (!(dialog && dialog.style.display !== "none")) { if (cf >= MAX_CF) { clearInterval(confirmTimer); handleSpecialAndClose(SCORE_TIMEOUT); } return; }
      const yesBtn = document.querySelector("button[id*='confirmationForm:yesButton']");
      if (!yesBtn) return;
      yesBtn.click(); yesClicked = true; clearInterval(confirmTimer);
      afterYesClicked();
      startResourceWatcher();
    }, POLL_CF);
  }

  /* ===== GLOBAL WATCHDOG (retry-aware) ===== */
  function scheduleWatchdog() {
    setTimeout(function globalWatchdog() {
      if (processingComplete) return;
      // لو حصلت إعادة محاولة جديدة، اديله نافذة كمان بدل ما يقطع المحاولة الجارية
      if (rtAttempt > watchdogFires && watchdogFires < MAX_RT_ATTEMPTS) { watchdogFires = rtAttempt; scheduleWatchdog(); return; }
      console.warn("⏱️ Watchdog finalize for " + CURRENT_LINE_ID);
      if (!yesClicked) { openNextLine(readScoreThenClose); } else { readScoreThenClose(); }
    }, WAIT_FOR_DISPATCH_SCORE + 60 * 1000);
  }
  scheduleWatchdog();

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

  /* ===== KNOWN-STATE WATCHDOG (مستمر فى كل المراحل) =====
     يفحص الحالات المعروفة (no longer provisioned=103 / out of service=101 / not found=105)
     باستمرار على صفحة clearview — أول ما يلاقى أى واحدة يسجّلها ويروح للخط التالى فوراً،
     بدون ما يكمّل قياس أو يقع فى لخبطة 103/101 أو ينتظر timeout. */
  const knownStateTimer = setInterval(() => {
    if (processingComplete) { clearInterval(knownStateTimer); return; }
    if (!location.href.includes("/expresse/clearview")) return;
    const ks = checkForKnownState();
    if (ks !== null) { clearInterval(knownStateTimer); handleSpecialAndClose(ks); }
  }, 700);

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
    if (b) { b.click(); clearInterval(realTimeTimer); armConfirm(); return; } // 🆕 يبدأ متابعة dialog التأكيد + retry
    if (rt >= MAX_RT) { clearInterval(realTimeTimer); handleSpecialAndClose(SCORE_TIMEOUT); }
  }, POLL_RT);

  /* ================== YES → early + final ==================
     اتنقلت لـ armConfirm() / afterYesClicked() / startResourceWatcher() فوق (قبل الـ watchdog)
     عشان نقدر نعيد استدعاءها فى كل محاولة retry عند فشل الـ Resource Allocator. */

})();
