// ==UserScript==
// @name         WFM Reporting — Voice Installation Raw Data → Service-Flow
// @namespace    service-flow.wfm.voice-raw
// @description  يفتح wfm.te.eg/WfmReports، يسجّل الدخول، Reports → FO Raw Data Reports → «+» → Voice Installation Raw Data Report → Add Report، يحطّ التواريخ (آخر 30 يوم) + Middle Upper / Asuit Region، يضغط Generate ثم Export، ويرفع الشيت تلقائياً على تقرير أوامر الشغل فى Service-Flow.
// @version      1.0.5
// @match        https://wfm.te.eg/WfmReports/*
// @grant        GM_xmlhttpRequest
// @connect      service-flow-menoskar42.replit.app
// @connect      replit.app
// @connect      wfm.te.eg
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mina109756";
  const PASS = "Mon_oskar11";
  const SF_URL   = "https://service-flow-menoskar42.replit.app";
  const SF_TOKEN = "sf-auto-upload-2026";
  const DAYS_BACK = 30;                       // من (النهاردة − 30) إلى النهاردة — زى الاستخدام الفعلى (7/3 → 8/2)
  const REPORT_NAME   = "Voice Installation Raw Data Report";
  const CATEGORY_NAME = "FO Raw Data Reports";
  // Sector/Region اختياريين: الحساب أصلاً محصور على GHNAT/Asuit، والتجربة الفعلية أثبتت
  // إن Generate بالتواريخ بس بيرجّع البيانات كاملة (244 صف) وهما سايبين "Select".
  // بنحاول نظبّطهم best-effort من غير ما نوقف التدفّق لو مانفعش.
  const SECTOR = "Middle Upper";
  const REGION = "Asuit Region";
  const REQUIRE_SECTOR_REGION = false;
  const AUTO_CLOSE_MS = 20000;                // يقفل التاب بعد الرفع (0 = مايقفلش)

  /* ================== أدوات عامة ================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { try { return !!el && el.getClientRects().length > 0; } catch (e) { return false; } };
  const txt = (el) => ((el && el.textContent) || "").replace(/\s+/g, " ").trim();

  async function waitFor(fn, ms, step) {
    const end = Date.now() + (ms || 30000);
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) {}
      await sleep(step || 300);
    }
    return null;
  }

  // كل الـ documents (الصفحة + أى iframes من نفس الأصل)
  function docs() {
    const out = [document];
    const walk = (root) => {
      let ifr = [];
      try { ifr = [...root.querySelectorAll("iframe,frame")]; } catch (e) {}
      for (const f of ifr) {
        let d = null; try { d = f.contentDocument; } catch (e) {}
        if (d && out.indexOf(d) === -1) { out.push(d); walk(d); }
      }
    };
    walk(document);
    return out;
  }
  function qAll(sel) {
    const r = [];
    for (const d of docs()) { try { r.push(...d.querySelectorAll(sel)); } catch (e) {} }
    return r;
  }
  // عنصر ظاهر نصّه بيطابق re
  function findByText(sel, re, maxLen) {
    return qAll(sel).find((e) => visible(e) && re.test(txt(e)) && (!maxLen || txt(e).length <= maxLen)) || null;
  }

  function fireClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    const o = { bubbles: true, cancelable: true, view: window };
    for (const t of ["pointerover", "mouseover", "pointerdown", "mousedown", "focus", "pointerup", "mouseup", "click"]) {
      try {
        const E = t.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent
                : (t === "focus" ? FocusEvent : MouseEvent);
        el.dispatchEvent(new E(t, o));
      } catch (e) { try { el.dispatchEvent(new MouseEvent(t.replace("pointer", "mouse"), o)); } catch (e2) {} }
    }
    try { if (typeof el.click === "function") el.click(); } catch (e) {}
    return true;
  }

  // كتابة قيمة فى input بطريقة تُشعِر Angular/React بالتغيير
  function setValue(input, value) {
    if (!input) return false;
    try { input.focus(); } catch (e) {}
    try {
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, "value");
      if (d && d.set) d.set.call(input, value); else input.value = value;
    } catch (e) { input.value = value; }
    for (const t of ["input", "change", "keyup", "blur"]) {
      try { input.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {}
    }
    return true;
  }

  /* ================== التواريخ ================== */
  const pad = (n) => String(n).padStart(2, "0");
  function dateRange() {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - DAYS_BACK);
    return { from, to };
  }
  // الواجهة بتستخدم input[type=date] غالباً (yyyy-mm-dd)، وإلا نص m/d/yyyy
  const isoOf  = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const usOf   = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

  function setDateInput(input, d) {
    if (!input) return false;
    const type = (input.getAttribute("type") || "").toLowerCase();
    return setValue(input, type === "date" ? isoOf(d) : usOf(d));
  }

  /* ================== بانر الحالة ================== */
  let bar;
  function banner(msg, color) {
    if (!document.body) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 12px;" +
        "font:bold 13px Arial;color:#fff;background:#8e1e1e;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.4)";
      document.body.appendChild(bar);
    }
    bar.style.background = color || "#8e1e1e";
    bar.textContent = msg;
    console.log("[WFM-VOICE]", msg);
  }

  /* ================== تسجيل الدخول ================== */
  async function login() {
    const pass = await waitFor(() => {
      const p = qAll("input[type='password']").find(visible);
      return p || null;
    }, 30000);
    if (!pass) return false;
    // خانة اليوزر = أول input نصّى ظاهر قبل خانة الباسورد
    const all = qAll("input").filter(visible);
    const user = all.slice(0, all.indexOf(pass)).reverse()
      .find((i) => !/password/i.test(i.type || "")) || all[0];
    banner("🔐 تسجيل الدخول…");
    if (user) setValue(user, USER);
    setValue(pass, PASS);
    await sleep(400);
    const btn = findByText("button, input[type='submit'], a", /^\s*login\s*$/i, 20)
             || qAll("button, input[type='submit']").find(visible);
    if (btn) fireClick(btn);
    else { try { pass.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); } catch (e) {} }
    return true;
  }

  // إرسال ضغطة كيبورد حقيقية (ng-select/PrimeNG بيستجيبوا للكيبورد أكتر من click)
  function pressKey(el, key, code) {
    if (!el) return;
    for (const type of ["keydown", "keypress", "keyup"]) {
      try {
        el.dispatchEvent(new KeyboardEvent(type, {
          key, code: code || key, keyCode: code || 0, which: code || 0, bubbles: true, cancelable: true,
        }));
      } catch (e) {}
    }
  }

  /* ================== دروب ليست (ng-select / PrimeNG / select) ================== */
  // بيفتح الدروب المرتبط بالـ label ويختار العنصر اللى نصّه يطابق valueRe
  async function pickFromDropdown(boxEl, valueRe) {
    if (!boxEl) return false;

    // (أ) لو <select> عادى: نختار مباشرةً من غير فتح قائمة
    const nativeSel = boxEl.tagName === "SELECT" ? boxEl : boxEl.querySelector && boxEl.querySelector("select");
    if (nativeSel) {
      const opt = [...nativeSel.options].find((o) => valueRe.test(txt(o) || o.textContent || ""));
      if (opt) {
        nativeSel.value = opt.value;
        for (const t of ["input", "change"]) { try { nativeSel.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {} }
        return true;
      }
    }

    // (ب) دروب مخصّص: افتحه ثم دوّر على العنصر
    fireClick(boxEl);
    await sleep(800);

    // بعض الدروبات فيها خانة بحث — الكتابة بتقلّل القائمة وبتسهّل المطابقة
    const typeBox = qAll("input").find((i) => visible(i) && !/hidden|checkbox|radio/i.test(i.type || "") &&
      (i === boxEl || (boxEl.contains && boxEl.contains(i)) || /search|filter/i.test((i.className || "") + (i.placeholder || ""))));
    if (typeBox) { setValue(typeBox, "Voice Installation"); await sleep(900); }

    const OPT_SEL = "li, .ng-option, .p-dropdown-item, [role='option'], option, .mat-option, .dropdown-item, .select2-results__option, td, div";
    const item = await waitFor(() => {
      const cands = qAll(OPT_SEL).filter((el) => {
        if (!visible(el) || !valueRe.test(txt(el))) return false;
        if (txt(el).length > 60) return false;                    // استبعد الحاويات الكبيرة
        return !el.querySelector(OPT_SEL.split(", ")[0]);         // الأعمق (مش حاوية لعنصر تانى)
      });
      cands.sort((a, b) => txt(a).length - txt(b).length);        // الأقرب للنص المطلوب
      return cands[0] || null;
    }, 9000);
    if (!item) return false;
    fireClick(item.closest("li,[role='option'],.ng-option,.p-dropdown-item,.dropdown-item") || item);
    await sleep(600);
    return true;
  }

  // هل اسم التقرير اتسجّل فعلاً فى المودال؟ (الخانة بتعرض الاسم الكامل بعد الاختيار)
  function reportNameSelected() {
    const re = new RegExp(REPORT_NAME.replace(/\s+/g, "\\s*"), "i");
    // (أ) قيمة أى input فى المودال بقت الاسم الكامل
    const byInput = qAll("input").some((i) => visible(i) && re.test(i.value || ""));
    if (byInput) return true;
    // (ب) ng-select بيعرض القيمة المختارة فى span مخصّص (مش فى الـ input)
    return qAll(".ng-value, .ng-value-label, .p-dropdown-label, .select2-selection__rendered")
      .some((e) => visible(e) && re.test(txt(e)));
  }

  // اختيار «Voice Installation Raw Data Report» مع تحقّق فعلى.
  // السبب: الضغط على صف الاختيار كان بيرجّع "نجاح" من غير ما القيمة تتسجّل، فالسكربت
  // كان بيكمّل لـ Add Report والتواريخ وGenerate وكلها بتفشل بصمت والمودال لسه مفتوح.
  async function selectReportName() {
    const re = new RegExp(REPORT_NAME.replace(/\s+/g, "\\s*"), "i");
    for (let round = 0; round < 3; round++) {
      // الخانة نفسها (input داخل المودال بجانب لابل Report Name)
      const box = qAll("input[placeholder], ng-select, .ng-select, .p-dropdown")
            .find((e) => visible(e) && /Select\s*Report/i.test(e.getAttribute("placeholder") || txt(e)))
        || fieldBoxByLabel(/Report\s*Name/i);
      if (!box) { await sleep(1000); continue; }

      fireClick(box);
      await sleep(600);

      // اكتب جزء مميّز عشان القائمة تفلتر لعنصر واحد
      const inp = box.tagName === "INPUT" ? box : box.querySelector("input");
      if (inp) { setValue(inp, "Voice Installation"); await sleep(1200); }

      // (1) الكيبورد أولاً — الأضمن مع ng-select/PrimeNG
      const kbTarget = inp || box;
      pressKey(kbTarget, "ArrowDown", 40);
      await sleep(400);
      pressKey(kbTarget, "Enter", 13);
      await sleep(900);
      if (reportNameSelected()) return true;

      // (2) لو الكيبورد مانفعش: اضغط صف الاختيار نفسه وكل آبائه مع تحقّق
      const OPT = "li, .ng-option, .p-dropdown-item, [role='option'], option, .mat-option, .dropdown-item, td, div, span";
      const hits = qAll(OPT).filter((el) => visible(el) && re.test(txt(el)) && txt(el).length <= 60);
      hits.sort((a, b) => txt(a).length - txt(b).length);
      for (const hit of hits.slice(0, 4)) {
        let el = hit;
        for (let up = 0; up < 3 && el; up++, el = el.parentElement) {
          fireClick(el);
          await sleep(500);
          if (reportNameSelected()) return true;
        }
      }
      await sleep(1000);
    }
    return false;
  }

  // أزرار التحكّم فى اللوحة الجانبية (سهم الطى/الفتح) — ممنوع نضغطها بالغلط.
  // دى كانت سبب «الشاشة البيضا»: الفلتر القديم كان بيطابق أى زر أيقونة بدون نص.
  function isPanelToggle(el) {
    const cls = String((el && el.className) || "");
    const al  = String((el && el.getAttribute && (el.getAttribute("aria-label") || "")) || "");
    return /toggle|collaps|expand|arrow|chevron|sidebar|menu/i.test(cls + " " + al);
  }

  // زر «+» بتاع Choose Report — بندوّر عليه جنب لابل "Choose Report" نفسه،
  // ولو مالقيناهوش بنقبل زر نصّه "+" بالظبط (مش أى زر أيقونة فاضى).
  function findPlusButton() {
    for (const d of docs()) {
      let lbls = [];
      try {
        lbls = [...d.querySelectorAll("label, span, div, h5, p, legend")]
          .filter((e) => e.children.length === 0 && /Choose\s*Report/i.test(txt(e)));
      } catch (e) { continue; }
      for (const lbl of lbls) {
        let p = lbl.parentElement;
        for (let up = 0; up < 5 && p; up++, p = p.parentElement) {
          const btns = [...p.querySelectorAll("button, a")].filter((b) => visible(b) && !isPanelToggle(b));
          const plus = btns.find((b) => txt(b) === "+" || b.querySelector(".fa-plus, .pi-plus, [class*='plus']"));
          if (plus) return plus;
        }
      }
    }
    return qAll("button, a").find((b) => visible(b) && !isPanelToggle(b) && txt(b) === "+") || null;
  }

  // هل لوحة البارامترات (يمين) ظهرت فعلاً؟ = علامة إن الكاتيجورى اتفتحت صح
  const paramsPaneOpen = () =>
    !!(findByText("label, span, div, h5, p", /Choose\s*Report/i, 40) ||
       findByText("span, div, h5", /All\s*Paramters|All\s*Parameters/i, 40));

  // الضغط على كاتيجورى «FO Raw Data Reports» مع تحقّق فعلى من النتيجة.
  // السبب: النص ممكن يكون جوّه span عميق، و.closest('a,li,div') ممكن يرجّع حاوية
  // مش قابلة للضغط — فالضغطة تروح فى الهوا واللوحة اليمين تفضل فاضية. هنا بنجرّب
  // العنصر وكل آبائه لحد 3 مستويات، وبعد كل ضغطة بنتأكد إن اللوحة ظهرت.
  async function clickCategory(re) {
    for (let round = 0; round < 3; round++) {
      const hits = qAll("a, li, span, div, td").filter((e) => visible(e) && re.test(txt(e)) && txt(e).length <= 40);
      // الأعمق الأول (أقرب للنص نفسه)
      hits.sort((a, b) => txt(a).length - txt(b).length);
      for (const hit of hits.slice(0, 4)) {
        const chain = [];
        let el = hit;
        for (let up = 0; up < 4 && el; up++, el = el.parentElement) chain.push(el);
        for (const target of chain) {
          fireClick(target);
          const ok = await waitFor(paramsPaneOpen, 2500, 250);
          if (ok) return true;
        }
      }
      await sleep(1200);
    }
    return false;
  }

  // لو اللوحة الجانبية اتطوت (شاشة بيضا) نرجّع نفتحها بالسهم
  async function ensurePanelOpen() {
    const listVisible = () => findByText("a, span, div, li", /FO\s*Raw\s*Data\s*Reports/i, 40);
    if (listVisible()) return true;
    const toggle = qAll("button, a, i, span").find((e) => visible(e) && isPanelToggle(e));
    if (toggle) { fireClick(toggle); await sleep(1200); }
    return !!listVisible();
  }

  // يلاقى الحاوية القابلة للضغط الخاصة بحقل عنوانه labelRe
  function fieldBoxByLabel(labelRe) {
    for (const d of docs()) {
      let labels = [];
      try {
        labels = [...d.querySelectorAll("label, span, div, th")]
          .filter((e) => e.children.length === 0 && labelRe.test(txt(e)));
      } catch (e) { continue; }
      for (const lbl of labels) {
        // ندوّر جوّه أقرب حاوية أب على عنصر دروب/إدخال
        let p = lbl.parentElement;
        for (let up = 0; up < 4 && p; up++, p = p.parentElement) {
          const box = p.querySelector("ng-select, .ng-select, .p-dropdown, select, .mat-select, input:not([type='hidden'])");
          if (box && visible(box)) return box;
        }
      }
    }
    return null;
  }

  // ملاحظة: اللابل بتاع الحقول المطلوبة شكله «From Date *» والنجمة فى span جوّاه،
  // فشرط children.length===0 القديم كان بيستبعده. دلوقتى بنسمح بلابل فيه عناصر صغيرة.
  function labelsMatching(labelRe) {
    const out = [];
    for (const d of docs()) {
      try {
        out.push(...[...d.querySelectorAll("label, span, div, th, p")]
          .filter((e) => visible(e) && labelRe.test(txt(e)) && txt(e).length <= 25 && e.children.length <= 2));
      } catch (e) {}
    }
    // الأعمق (أقصر نص) الأول
    return out.sort((a, b) => txt(a).length - txt(b).length);
  }

  // حاوية الحقل: أقرب أب فيه input (وغالباً معاه زر التقويم)
  function fieldGroup(labelRe) {
    for (const lbl of labelsMatching(labelRe)) {
      let p = lbl.parentElement;
      for (let up = 0; up < 5 && p; up++, p = p.parentElement) {
        const inp = [...p.querySelectorAll("input")]
          .find((i) => visible(i) && !/hidden|button|submit|checkbox|radio/i.test(i.type || ""));
        if (inp) return { group: p, input: inp };
      }
    }
    return null;
  }

  function inputByLabel(labelRe) {
    const g = fieldGroup(labelRe);
    return g ? g.input : null;
  }

  /* ================== اختيار التاريخ من التقويم ================== */
  // خانات التاريخ هنا readonly — مابتقبلش كتابة، لازم نفتح التقويم ونضغط اليوم.
  const MONTHS3 = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  // بيدوّر على رأس التقويم المفتوح («AUG 2026») ويرجّع العنصر + الشهر/السنة
  function calendarHeader() {
    const els = qAll("button, span, div").filter((e) => {
      if (!visible(e) || e.children.length > 2) return false;
      return /^[A-Za-z]{3,9}\s+\d{4}$/.test(txt(e));
    });
    els.sort((a, b) => txt(a).length - txt(b).length);
    for (const e of els) {
      const m = txt(e).match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
      if (!m) continue;
      const mi = MONTHS3.indexOf(m[1].slice(0, 3).toUpperCase());
      if (mi >= 0) return { el: e, month: mi, year: Number(m[2]) };
    }
    return null;
  }

  // أزرار التنقّل بين الشهور داخل التقويم
  function calNavButtons() {
    const btns = qAll("button").filter(visible);
    const prev = btns.find((b) => /prev/i.test((b.getAttribute("aria-label") || "") + (b.className || "")));
    const next = btns.find((b) => /next/i.test((b.getAttribute("aria-label") || "") + (b.className || "")));
    return { prev, next };
  }

  // يفتح تقويم الحقل ويختار اليوم المطلوب
  async function pickDateViaCalendar(labelRe, target) {
    const g = fieldGroup(labelRe);
    if (!g) return false;

    // زر التقويم جنب الخانة (أيقونة) — وإلا نضغط الخانة نفسها
    const toggle = [...g.group.querySelectorAll("button")].find(visible) || g.input;
    fireClick(toggle);

    const hdr0 = await waitFor(calendarHeader, 8000, 250);
    if (!hdr0) return false;

    // نتنقّل للشهر/السنة المطلوبين
    const want = target.getFullYear() * 12 + target.getMonth();
    for (let step = 0; step < 40; step++) {
      const h = calendarHeader();
      if (!h) break;
      const cur = h.year * 12 + h.month;
      if (cur === want) break;
      const { prev, next } = calNavButtons();
      const btn = cur > want ? prev : next;
      if (!btn) break;
      fireClick(btn);
      await sleep(350);
    }

    // نضغط رقم اليوم داخل شبكة التقويم (نستبعد الأيام المعطّلة)
    const day = String(target.getDate());
    const cell = await waitFor(() => {
      const cands = qAll("td, button, div, span").filter((e) => {
        if (!visible(e) || txt(e) !== day) return false;
        if (e.getAttribute("aria-disabled") === "true" || e.disabled) return false;
        const cls = String(e.className || "");
        return !/disabled/i.test(cls);
      });
      // الأعمق: العنصر اللى مفيهوش عنصر تانى بنفس النص
      cands.sort((a, b) => (a.children.length - b.children.length));
      return cands[0] || null;
    }, 6000, 250);
    if (!cell) return false;

    fireClick(cell.closest("td,button") || cell);
    await sleep(700);
    return !!String(g.input.value || "").trim();
  }

  /* ================== التقاط ملف التصدير ================== */
  // WFM بيولّد الملف فى المتصفح (blob) أو بيرجّعه من رابط — بنعترض الاتنين.
  let captured = null;   // { name, blob }
  const onCapture = [];
  function gotFile(name, blob) {
    if (!blob || captured) return;
    captured = { name: name || "wfm_voice_raw.csv", blob };
    console.log("[WFM-VOICE] 📦 اتلقط الملف:", captured.name, blob.size, "bytes");
    onCapture.forEach((f) => { try { f(captured); } catch (e) {} });
  }

  function installHooks(win) {
    try {
      // (1) createObjectURL — أكتر طريقة شائعة للتنزيل من الواجهات الحديثة
      const origCreate = win.URL.createObjectURL.bind(win.URL);
      win.URL.createObjectURL = function (obj) {
        try { if (obj instanceof win.Blob && obj.size > 200) gotFile(null, obj); } catch (e) {}
        return origCreate(obj);
      };
      // (2) fetch — لو الملف بيتجاب من endpoint
      const origFetch = win.fetch;
      if (origFetch) {
        win.fetch = async function (...args) {
          const res = await origFetch.apply(this, args);
          try {
            const ct = (res.headers.get("content-type") || "").toLowerCase();
            const cd = (res.headers.get("content-disposition") || "");
            if (/csv|excel|spreadsheet|octet-stream/.test(ct) || /attachment/i.test(cd)) {
              const c = res.clone();
              c.blob().then((b) => {
                const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
                if (b.size > 200) gotFile(m ? decodeURIComponent(m[1]) : null, b);
              }).catch(() => {});
            }
          } catch (e) {}
          return res;
        };
      }
      // (3) XHR
      const OrigXHR = win.XMLHttpRequest;
      if (OrigXHR) {
        const open = OrigXHR.prototype.open, send = OrigXHR.prototype.send;
        OrigXHR.prototype.open = function (m, u) { this.__u = u; return open.apply(this, arguments); };
        OrigXHR.prototype.send = function () {
          this.addEventListener("load", () => {
            try {
              const cd = this.getResponseHeader("content-disposition") || "";
              const ct = (this.getResponseHeader("content-type") || "").toLowerCase();
              if (/attachment/i.test(cd) || /csv|excel|spreadsheet|octet-stream/.test(ct)) {
                let b = this.response;
                if (typeof b === "string") b = new win.Blob([b], { type: ct || "text/csv" });
                if (b && b.size > 200) {
                  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
                  gotFile(m ? decodeURIComponent(m[1]) : null, b);
                }
              }
            } catch (e) {}
          });
          return send.apply(this, arguments);
        };
      }
      // (4) رابط تحميل مباشر (a[download]) — نجيبه بـ fetch ونلقطه
      win.document.addEventListener("click", (ev) => {
        try {
          const a = ev.target && ev.target.closest && ev.target.closest("a[download],a[href^='blob:']");
          if (!a || !a.href) return;
          origFetch(a.href).then((r) => r.blob()).then((b) => { if (b.size > 200) gotFile(a.getAttribute("download"), b); }).catch(() => {});
        } catch (e) {}
      }, true);
    } catch (e) { console.warn("[WFM-VOICE] hook err", e); }
  }
  installHooks(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);

  /* ================== الرفع لـ Service-Flow ================== */
  function sfUpload(blob, filename) {
    return new Promise((resolve) => {
      try {
        const fd = new FormData();
        fd.append("file", blob, filename);
        GM_xmlhttpRequest({
          method: "POST",
          url: SF_URL + "/api/work-orders/import",
          headers: { "X-Upload-Token": SF_TOKEN },
          data: fd,
          timeout: 300000,
          onload: (r) => {
            console.log("[WFM-VOICE] رفع أوامر الشغل", r.status, (r.responseText || "").slice(0, 300));
            resolve(r.status >= 200 && r.status < 300 ? (r.responseText || "") : null);
          },
          onerror: (r) => { console.warn("[WFM-VOICE] فشل الرفع", r && r.status); resolve(null); },
          ontimeout: () => resolve(null),
        });
      } catch (e) { resolve(null); }
    });
  }

  /* ================== التدفّق الرئيسى ================== */
  let started = false;
  async function runFlow() {
    if (started) return; started = true;

    // 1) Reports فى الشريط الجانبى
    banner("📊 فتح Reports…");
    const reports = await waitFor(() => findByText("a, span, div, li, button", /^\s*Reports\s*$/i, 20), 30000);
    if (reports) { fireClick(reports.closest("a,li,button") || reports); await sleep(1800); }

    // 2) FO Raw Data Reports من قائمة Report Category
    banner("🗂️ اختيار «" + CATEGORY_NAME + "»…");
    await ensurePanelOpen();
    await waitFor(() => findByText("a, span, div, li", /FO\s*Raw\s*Data\s*Reports/i, 40), 25000);
    const catOk = await clickCategory(/FO\s*Raw\s*Data\s*Reports/i);
    if (!catOk) { banner("❌ الضغط على «FO Raw Data Reports» مافتحش لوحة البارامترات", "#b71c1c"); return; }
    await sleep(800);

    // 3) زر «+» بتاع Choose Report (مش سهم طى اللوحة)
    banner("➕ فتح Choose Report…");
    const plus = await waitFor(findPlusButton, 20000);
    if (!plus) { banner("❌ مش لاقى زر «+»", "#b71c1c"); return; }
    fireClick(plus);
    // نتأكد إن المودال فتح فعلاً، وإلا نضغط تانى
    let modalOk = await waitFor(() => findByText("label, span, div, h4, h5", /Report\s*Name/i, 30), 6000);
    if (!modalOk) { fireClick(plus); modalOk = await waitFor(() => findByText("label, span, div, h4, h5", /Report\s*Name/i, 30), 8000); }
    if (!modalOk) { banner("❌ مودال Choose Report مافتحش", "#b71c1c"); return; }
    await sleep(800);

    // 4) من مودال Choose Report: اختَر اسم التقرير ثم Add Report
    banner("📄 اختيار «" + REPORT_NAME + "»…");
    const okPick = await selectReportName();
    if (!okPick) { banner("❌ اسم التقرير مااتسجّلش فى الخانة", "#b71c1c"); return; }
    banner("✅ اتسجّل اسم التقرير — Add Report…");
    await sleep(500);

    // Add Report — ونتأكد إن المودال قفل فعلاً (وإلا نضغط تانى)
    const addBtn = await waitFor(() => findByText("button, a", /Add\s*Report/i, 25), 10000);
    if (!addBtn) { banner("❌ مش لاقى Add Report", "#b71c1c"); return; }
    fireClick(addBtn);
    let modalClosed = await waitFor(() => !findByText("h4, h5, div, span", /^\s*Choose\s*Report\s*$/i, 20), 6000);
    if (!modalClosed) {
      const again = findByText("button, a", /Add\s*Report/i, 25);
      if (again) fireClick(again);
      modalClosed = await waitFor(() => !findByText("h4, h5, div, span", /^\s*Choose\s*Report\s*$/i, 20), 6000);
    }
    if (!modalClosed) { banner("❌ مودال Choose Report ماقفلش بعد Add Report", "#b71c1c"); return; }
    await sleep(2000);

    // 5) البارامترات: التواريخ + Sector + Region
    const { from, to } = dateRange();
    banner(`📅 ${isoOf(from)} → ${isoOf(to)} …`);
    const fromIn = await waitFor(() => inputByLabel(/From\s*Date/i), 20000);
    const toIn   = inputByLabel(/To\s*Date/i);
    if (!fromIn || !toIn) { banner("❌ مش لاقى خانات التاريخ", "#b71c1c"); return; }

    // الخانات دى readonly (Material datepicker) — الكتابة المباشرة مابتنفعش غالباً،
    // فبنجرّبها الأول وبعدين نرجع للتقويم (فتح → التنقّل للشهر → ضغط اليوم).
    const setOneDate = async (labelRe, input, d, what) => {
      setDateInput(input, d);
      await sleep(500);
      if (String(input.value || "").trim()) return true;
      banner(`📆 ${what}: اختيار من التقويم…`);
      const ok = await pickDateViaCalendar(labelRe, d);
      return ok || !!String(input.value || "").trim();
    };

    if (!(await setOneDate(/From\s*Date/i, fromIn, from, "من"))) {
      banner("❌ مش قادر أحدّد «From Date»", "#b71c1c"); return;
    }
    await sleep(600);
    if (!(await setOneDate(/To\s*Date/i, toIn, to, "إلى"))) {
      banner("❌ مش قادر أحدّد «To Date»", "#b71c1c"); return;
    }
    banner(`✅ التواريخ: ${String(fromIn.value).trim()} → ${String(toIn.value).trim()}`);
    await sleep(600);

    // Sector/Region — محاولة اختيارية فقط. لو الدروب مااستجابش بنكمّل عادى، لأن الحساب
    // محصور أصلاً على المنطقة وGenerate بالتواريخ بس بيرجّع نفس البيانات.
    if (REQUIRE_SECTOR_REGION) {
      banner("🌍 Sector / Region…");
      const secBox = fieldBoxByLabel(/^\s*Sector\s*$/i);
      if (secBox) await pickFromDropdown(secBox, new RegExp(SECTOR.replace(/\s+/g, "\\s*"), "i"));
      await sleep(500);
      const regBox = fieldBoxByLabel(/^\s*Region\s*$/i);
      if (regBox) await pickFromDropdown(regBox, new RegExp(REGION.replace(/\s+/g, "\\s*"), "i"));
      await sleep(600);
    }

    // 6) Generate
    banner("⚙️ Generate…");
    const gen = await waitFor(() => findByText("button, a", /^\s*Generate\s*$/i, 20), 15000);
    if (!gen) { banner("❌ مش لاقى زر Generate", "#b71c1c"); return; }
    fireClick(gen);

    // نستنّى صفوف فعلية — زر Export بيبقى موجود حتى مع «No Rows To Show»،
    // فالانتظار عليه لوحده كان ممكن يصدّر ملف فاضى. العلامة الأكيدة: عدّاد
    // الصفحات بيتحوّل من «0 to 0 of 0» لأرقام حقيقية.
    const hasRows = await waitFor(() => {
      const t = docs().map((d) => { try { return d.body ? d.body.innerText : ""; } catch (e) { return ""; } }).join(" ");
      if (/No\s*Rows\s*To\s*Show/i.test(t)) return null;
      const m = t.match(/(\d+)\s*to\s*(\d+)\s*of\s*(\d+)/i);
      return m && Number(m[3]) > 0 ? m[3] : null;
    }, 120000, 800);

    if (!hasRows) { banner("⚠️ Generate مارجّعش صفوف — راجع التواريخ.", "#ef6c00"); return; }
    banner(`✅ ظهر ${hasRows} صف — جارٍ التصدير…`);
    await sleep(2500);

    // 7) Export
    banner("⬇️ Export…");
    const exp = await waitFor(() => findByText("button, a", /^\s*Export\s*$/i, 15), 30000);
    if (!exp) { banner("❌ مش لاقى زر Export", "#b71c1c"); return; }
    fireClick(exp);

    // 8) استنى الملف يتلقط ثم ارفعه
    banner("⏳ فى انتظار الملف…");
    const file = await waitFor(() => captured, 120000, 500);
    if (!file) { banner("⚠️ الملف اتحمّل على الجهاز بس مااتلقطش — ارفعه يدوى.", "#ef6c00"); return; }

    banner("📤 رفع الشيت لـ Service-Flow…");
    const resp = await sfUpload(file.blob, file.name || "voice_installation_raw.csv");
    if (!resp) { banner("⚠️ فشل الرفع — الملف موجود فى التحميلات، ارفعه يدوى.", "#ef6c00"); return; }

    let msg = "✅ اتحدّث تقرير أوامر الشغل.";
    try {
      const j = JSON.parse(resp);
      if (j && typeof j.inserted === "number") {
        msg = `✅ اتحدّث تقرير أوامر الشغل — ${j.inserted} أمر` +
              (j.skipped ? ` (تخطّى ${j.skipped})` : "") +
              (j.total ? ` من ${j.total} صف` : "");
      }
    } catch (e) {}
    banner(msg, "#2e7d32");

    if (AUTO_CLOSE_MS > 0) {
      setTimeout(() => { try { window.close(); } catch (e) {} }, AUTO_CLOSE_MS);
    }
  }

  /* ================== الراوتر ================== */
  function boot() {
    if (!document.body) { setTimeout(boot, 200); return; }
    banner("⚙️ WFM — Voice Installation Raw Data");

    const onLogin = () => /#\/login/i.test(location.hash) || qAll("input[type='password']").some(visible);
    if (onLogin()) {
      login();
      // بعد نجاح الدخول الواجهة بتروح للـ Home — نكمّل التدفّق
      waitFor(() => !onLogin(), 90000).then((ok) => { if (ok) setTimeout(runFlow, 2500); });
    } else {
      setTimeout(runFlow, 1500);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // تشغيل يدوى من الكونسول لو حبيت
  window.WFM_VOICE_RUN = () => { started = false; runFlow(); };
})();
