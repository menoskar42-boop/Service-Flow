// ==UserScript==
// @name         WE OAS BI — دخول تلقائى + تقرير 430D
// @namespace    service-flow.we-oas.login
// @description  يسجّل الدخول على we-oas.te.eg BI، ثم على Oracle Analytics: يبحث 430d، يفتح تقرير «القطاع-TEDATA - Details متابعة اعطال»، يضبط from_date=يوم 25 من الشهر السابق و to_date=اليوم، Apply، ثم تبويب «تفاصيل المتبقى» ثم Apply. لا يرفع أى بيانات للموقع.
// @version      1.1.2
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
    for (const t of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    const form = el.closest && el.closest("form");
    if (form && typeof form.requestSubmit === "function") { try { form.requestSubmit(el.type === "submit" ? el : undefined); } catch (e) {} }
    return true;
  }

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
    banner("📂 البحث عن كارت تقرير 430D…");
    // 1) جرّب تلاقيه فى المفضلة/اللوحات مباشرة (البحث مش لازم)
    let card = await waitFor(findReportCard, 9000);
    // 2) لو ملقاش، اكتب فى خانة البحث وحاول تانى
    if (!card) {
      const box = qAll("input,textarea").find((i) => visible(i) && /search\s*everything/i.test(i.placeholder || ""));
      if (box) { setValue(box, "430d"); box.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true })); box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); }
      card = await waitFor(findReportCard, 20000);
    }
    if (!card) { banner("❌ لم أجد كارت «430D القطاع-TEDATA»", "#c62828"); return; }
    banner("📂 فتح التقرير…");
    clickEl(card);
    // التقرير غالباً بيفتح فى تاب جديد — السكربت هيكمّل هناك تلقائياً (الفلاج شغّال)
  }

  /* ================== 3) صفحة التقرير: التواريخ + Apply + تبويب المتبقى + Apply ================== */
  function findLabeledInput(re) {
    for (const d of docsList()) {
      let lbl;
      try { lbl = [...d.querySelectorAll("*")].find((e) => e.children.length === 0 && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 20); } catch (e) {}
      if (lbl) {
        let node = lbl;
        for (let k = 0; k < 6 && node; k++) {
          const inp = [...node.querySelectorAll("input")].find((i) => visible(i) && i.type !== "hidden" && i.type !== "button" && i.type !== "submit");
          if (inp) return inp;
          node = node.parentElement;
        }
      }
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
    banner("▶️ Apply (التفاصيل) — استنى النتائج…");
    clickEl(findBtn(/^\s*apply\s*$/i) || apply);
    await sleep(7000); // انتظار ورود النتائج
    // تبويب «تفاصيل المتبقى»
    const tab = await waitFor(() => qAll("a,span,div,td,li").find((e) => visible(e) && /تفاصيل\s*(ال)?م[بت]?قى|متبقى|مبقى/.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 25), 15000);
    if (tab) { banner("↪️ تبويب تفاصيل المتبقى…"); clickEl(tab); await sleep(1800); }
    else banner("⚠️ لم أجد تبويب «تفاصيل المتبقى»", "#ef6c00");
    banner("▶️ Apply (المتبقى) — استنى النتائج…");
    const apply2 = findBtn(/^\s*apply\s*$/i);
    if (apply2) clickEl(apply2);
    clearFlag();
    banner("✅ خلص — المفروض ظهرت نتائج «تفاصيل المتبقى».", "#2e7d32");
  }

  /* ================== الراوتر ================== */
  const path = location.pathname + location.search;
  const isLogin  = /bi-security-login/i.test(path);
  const isReport = /saw\.dll|\/analytics\//i.test(path);
  const isHome   = !isReport && (/\/dv\//i.test(path) || /home\.jsp/i.test(path));

  let started = false;
  async function kickoff(manual) {
    if (started) return; started = true;
    if (isReport) await reportFlow();
    else if (isHome) await homeFlow();
  }

  if (isLogin) {
    autoLogin();
  } else {
    ui();
    // شغّل تلقائياً لو جايين من الدخول (الفلاج شغّال)، بعد ما الـ SPA يجهز
    if (flagOn()) waitFor(() => document.body, 10000).then(() => sleep(1800)).then(() => kickoff(false)).catch((e) => banner("❌ " + (e && e.message || e), "#c62828"));
  }
})();
