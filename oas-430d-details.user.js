// ==UserScript==
// @name         OAS 430D Details Auto (Service-Flow)
// @namespace    service-flow.oas
// @description  أتمتة تقرير 430D القطاع-TEDATA - Details على Oracle Analytics (we-oas): لوجين (Sign In أوتوماتيك) + فتح التقرير من صفحة الهوم + اختيار السنترال (select) + التاريخ (أول الشهر→اليوم) + Apply + تصدير Excel للتفاصيل وتفاصيل المتبقى. v0.9 — @grant unsafeWindow لتجاوز CSP (السكريبت مكانش بيشتغل أصلاً) + مربع ظاهر على صفحة اللوجين + jQuery عبر unsafeWindow.
// @version      0.9.0
// @match        https://we-oas.te.eg/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // نشغّل فى sandbox (بسبب @grant) لتجاوز CSP بتاع Oracle؛ نوصل لـ jQuery بتاع الصفحة عبر unsafeWindow
  const PAGE = (typeof unsafeWindow !== "undefined" && unsafeWindow) ? unsafeWindow : window;

  /* ================== CONFIG ================== */
  const USER = "mena.haleem@te.eg"; // زى ما ظاهر فى خانة اللوجين
  const PASS = "Mon_oskar352";
  const GROUP  = "قطاع وسط الصعيد";
  const REGION = "منطقة تليفونات أسيوط";
  const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];
  const TAB_DETAILS   = "التفاصيل";
  const TAB_REMAINING = "تفاصيل متبقى";
  // رابط فتح التقرير مباشرة (بدل البحث والضغط فى الكتالوج)
  const REPORT_URL = "https://we-oas.te.eg/analytics/saw.dll?bipublisherEntry&action=open&bippath=" +
    encodeURIComponent("/FCC Prod/430D القطاع-TEDATA - Details متابعة اعطال.xdo") + "&itemtype=.xdo";

  const log  = (...a) => console.log("%c[OAS]", "color:#0a0;font-weight:bold", ...a);
  const warn = (...a) => console.warn("[OAS]", ...a);
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => el && el.offsetParent !== null;

  function waitFor(cond, { timeout = 90000, interval = 400 } = {}) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        let v; try { v = cond(); } catch (e) { v = null; }
        if (v) { clearInterval(id); resolve(v); }
        else if (Date.now() - t0 > timeout) { clearInterval(id); reject(new Error("timeout")); }
      }, interval);
    });
  }

  /* ================== SELECT / INPUT HELPERS ================== */
  // يلاقى الـ <select> اللى فيه option نصّها = القيمة المطلوبة (مش محتاج id)
  function findSelectByOption(text) {
    const T = norm(text);
    for (const sel of document.querySelectorAll("select")) {
      for (const o of sel.options) {
        const ot = norm(o.textContent);
        if (ot === T || ot.indexOf(T) === 0) return sel;
      }
    }
    return null;
  }
  function selectOption(sel, text) {
    const T = norm(text);
    let opt = [...sel.options].find(o => norm(o.textContent) === T)
           || [...sel.options].find(o => norm(o.textContent).indexOf(T) === 0);
    if (!opt) { warn("مش لاقى option:", text, "فى", sel.id || sel.name); return false; }
    sel.value = opt.value;
    [...sel.options].forEach(o => (o.selected = false));
    opt.selected = true;
    ["input", "change"].forEach(ev => sel.dispatchEvent(new Event(ev, { bubbles: true })));
    try { if (typeof sel.onchange === "function") sel.onchange(); } catch (e) {}
    log("اخترت:", norm(opt.textContent), "فى select", sel.id || sel.name || "");
    return true;
  }
  function setInputValue(input, val) {
    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(input, val); else input.value = val;
    ["input", "change", "blur"].forEach(ev => input.dispatchEvent(new Event(ev, { bubbles: true })));
  }

  /* ================== DATES (أول الشهر → اليوم، صيغة MM-DD-YYYY) ================== */
  const pad = (n) => String(n).padStart(2, "0");
  function firstOfMonth() { const d = new Date(); return `${pad(d.getMonth() + 1)}-01-${d.getFullYear()}`; }
  function todayStr()    { const d = new Date(); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`; }
  function findDateInput(key) {
    // key = "from" أو "to"
    let el = document.querySelector(`input[id*='${key}_date' i], input[name*='${key}_date' i]`);
    if (el) return el;
    const holder = document.querySelector(`[id*='${key}_date' i]`);
    if (holder) { const inp = holder.querySelector("input"); if (inp) return inp; }
    return null;
  }
  function setDates() {
    const f = findDateInput("from"), t = findDateInput("to");
    if (f) setInputValue(f, firstOfMonth()); else warn("مش لاقى from_date");
    if (t) setInputValue(t, todayStr());     else warn("مش لاقى to_date");
    log("التاريخ:", firstOfMonth(), "→", todayStr());
  }

  /* ================== BUTTONS / TABS / EXPORT ================== */
  function findByText(sel, text, exact = true) {
    const T = norm(text);
    return [...document.querySelectorAll(sel)].find(e => {
      const t = norm(e.textContent || e.value || "");
      return visible(e) && (exact ? t === T : t.indexOf(T) >= 0);
    });
  }
  function clickApply() {
    const b = findByText("button, input[type='submit'], input[type='button'], a", "Apply")
           || [...document.querySelectorAll("button,input")].find(e => visible(e) && /apply/i.test(e.value || e.textContent || ""));
    if (b) { b.click(); log("Apply ✔"); return true; }
    warn("مش لاقى زر Apply"); return false;
  }
  function clickTab(name) {
    const tab = findByText("a, span, div, li, td", name);
    if (tab) { tab.click(); log("تاب:", name); return true; }
    warn("مش لاقى تاب:", name); return false;
  }
  function exportExcel() {
    // 1) لو قايمة التصدير مفتوحة: دوس Excel (*.xlsx)
    let item = [...document.querySelectorAll("a, span, div, li, button")]
      .find(e => visible(e) && /excel/i.test(e.textContent) && /xlsx/i.test(e.textContent));
    if (item) { item.click(); log("تصدير Excel ✔"); return true; }
    // 2) افتح أيقونة التصدير فى التولبار الأول
    const icon = [...document.querySelectorAll("a, img, span, div, button")]
      .find(e => visible(e) && /export|تصدير|xlsx|excel/i.test((e.title || "") + (e.getAttribute && (e.getAttribute("aria-label") || "") || "")));
    if (icon) { icon.click(); log("فتحت قايمة التصدير — دوس الزر تانى بعد ثانية"); return "menu-opened"; }
    warn("مش لاقى زر/قايمة التصدير — محتاج أشوف الـ DOM بتاعه"); return false;
  }

  /* ================== ORCHESTRATION (سنترال واحد) ================== */
  let busy = false;
  async function fillAndApply(central) {
    if (busy) return; busy = true;
    try {
      // ملاحظة: تم إلغاء اختيار القطاع (قطاع وسط الصعيد) والمنطقة (منطقة تليفونات أسيوط)
      // لأن كل السنترالات بتظهر بدونهم — فبنختار السنترال مباشرة.
      setStatus("① السنترال: " + central + " …");
      const c = findSelectByOption("الغنايم");
      if (!c) throw new Error("مش لاقى دروب السنترال (P_CENTRAL_NAME)");
      selectOption(c, central);
      await sleep(600);

      setStatus("② التاريخ…");
      setDates();
      await sleep(400);

      setStatus("③ Apply…");
      clickApply();
      setStatus("✔ تم — استنى التقرير يحمّل ثم صدّر");
    } catch (e) {
      warn(e); setStatus("✖ " + e.message);
    } finally { busy = false; }
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ================== LOGIN (Knockout / Oracle JET — bitech-login-form) ================== */
  // كتابة فى الخانة مع سلسلة أحداث كاملة عشان Knockout يحدّث الـ observable
  // (bindings: value=change | textInput=input) وإلا الـ Sign In بيبعت بيانات فاضية.
  function typeInto(el, val) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, val); else el.value = val;
    ["keydown", "keypress", "input", "keyup", "change", "blur"].forEach(t => {
      try {
        el.dispatchEvent(t.indexOf("key") === 0
          ? new KeyboardEvent(t, { bubbles: true, key: "a" })
          : new Event(t, { bubbles: true }));
      } catch (e) {}
    });
  }
  // مزامنة قيمة الخانة (المحفوظة/autofill) للـ KO/jQuery من غير ما نغيّرها
  function syncField(el) {
    if (!el) return;
    ["input", "keyup", "change", "blur"].forEach(t => { try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {} });
    try { if (PAGE.jQuery) PAGE.jQuery(el).trigger("change"); } catch (e) {}
  }
  function fillLoginFields() {
    const pw = document.querySelector("input[type='password']");
    if (!pw || !visible(pw)) return null;
    const uf = document.querySelector(
      "form.bitech-login-form input[type='text'], form.bitech-login-form input[type='email']," +
      "input[name='j_username'], input[type='text']:not([type='hidden']), input[type='email'], input[name*='user' i]");
    // نحافظ على القيمة المحفوظة (autofill) ونزامنها؛ نملأ بس لو فاضية
    if (uf) { if (!uf.value.trim()) typeInto(uf, USER); else syncField(uf); }
    if (!pw.value) typeInto(pw, PASS); else syncField(pw);
    return pw;
  }
  // زر Sign In معروف: <button id="btn_login" class="bitech-signin-button">
  function findSignIn() {
    let b = document.querySelector("#btn_login, .bitech-signin-button");
    if (b && visible(b)) return b;
    const re = /^\s*(sign\s*in|log\s*in|دخول)\s*$/i;
    return [...document.querySelectorAll("input[type='submit'], button, a, [role='button']")]
      .find(e => visible(e) && (re.test(norm(e.textContent)) || re.test(e.value || ""))) || null;
  }
  function clickEl(b) {
    if (!b) return;
    // الأضمن: jQuery trigger (الزر متسجّل بـ jQuery click handler)
    try { if (PAGE.jQuery) { PAGE.jQuery(b).trigger("click"); log("🔐 jQuery trigger click"); } } catch (e) {}
    ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(t => {
      try { b.dispatchEvent(new (t.indexOf("pointer") === 0 ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    });
    try { b.click(); } catch (e) {}
  }
  function submitLogin(pw) {
    fillLoginFields(); // تأكيد تحديث الـ observables قبل الضغط
    setTimeout(() => {
      const b = findSignIn();
      log("🔐 Sign In element:", b ? (b.tagName + " «" + norm(b.textContent || b.value) + "» id=" + b.id + " class=" + (b.className || "").slice(0, 45)) : "مش لاقيه");
      if (b) clickEl(b); else warn("مش لاقى زر Sign In");
      // Enter على الباسورد كإضافة
      ["keydown", "keypress", "keyup"].forEach(t =>
        pw.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })));
    }, 500);
  }
  function loginBadge() {
    if (document.getElementById("oas-login-badge")) return;
    const d = document.createElement("div");
    d.id = "oas-login-badge";
    d.textContent = "🔐 OAS: بيحاول يسجّل دخول…";
    d.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;background:#16a34a;color:#fff;" +
      "font:bold 13px Arial;padding:8px 12px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.4);direction:rtl";
    (document.body || document.documentElement).appendChild(d);
  }
  function tryLogin() {
    if (!document.querySelector("input[type='password']")) return false;
    loginBadge();
    let done = false, tries = 0;
    const iv = setInterval(() => {
      tries++;
      const pw = fillLoginFields();
      if (!pw) { if (tries > 40) clearInterval(iv); return; }
      const b = findSignIn();
      if (!done && (b || tries >= 8)) {
        done = true; clearInterval(iv);
        setTimeout(() => submitLogin(pw), 1000);
      } else if (tries > 40) { clearInterval(iv); }
    }, 500);
    return true;
  }

  /* ================== CONTROL PANEL ================== */
  let panelEl, statusEl;
  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
  function buildPanel() {
    if (document.getElementById("oas-panel")) return;
    if (!findSelectByOption("الغنايم")) return; // بس فى الـ frame اللى فيه دروب-ليست السنترالات
    panelEl = document.createElement("div");
    panelEl.id = "oas-panel";
    panelEl.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;background:#0f172a;color:#fff;" +
      "font:13px/1.5 Arial;padding:10px 12px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.4);width:270px;direction:rtl";
    panelEl.innerHTML =
      '<div style="font-weight:bold;margin-bottom:6px">📊 OAS 430D — تشغيل (v0.9)</div>' +
      '<select id="oas-central" style="width:100%;padding:5px;border-radius:6px;margin-bottom:6px">' +
      CENTRALS.map(c => `<option>${c}</option>`).join("") + "</select>" +
      '<div id="oas-status" style="min-height:30px;color:#b2ff59;margin-bottom:6px;font-size:12px"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
        '<button id="oas-fill" style="flex:1 1 100%;background:#2563eb;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer">① املأ + Apply</button>' +
        '<button id="oas-tab1" style="flex:1;background:#334155;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer">تاب التفاصيل</button>' +
        '<button id="oas-tab2" style="flex:1;background:#334155;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer">تاب المتبقى</button>' +
        '<button id="oas-exp" style="flex:1 1 100%;background:#16a34a;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer;margin-top:3px">② صدّر Excel (التاب الحالى)</button>' +
      "</div>";
    (document.body || document.documentElement).appendChild(panelEl);
    statusEl = panelEl.querySelector("#oas-status");
    const centralSel = panelEl.querySelector("#oas-central");
    panelEl.querySelector("#oas-fill").onclick = () => fillAndApply(centralSel.value);
    panelEl.querySelector("#oas-tab1").onclick = () => clickTab(TAB_DETAILS);
    panelEl.querySelector("#oas-tab2").onclick = () => clickTab(TAB_REMAINING);
    panelEl.querySelector("#oas-exp").onclick  = () => exportExcel();
    log("لوحة التحكم ظهرت — الـ frame ده فيه الدروب-ليست ✔");
  }

  /* ================== HOME PAGE (فتح التقرير) ================== */
  function buildHomeButton() {
    if (document.getElementById("oas-home-btn")) return;
    const b = document.createElement("button");
    b.id = "oas-home-btn";
    b.textContent = "▶️ افتح تقرير 430D متابعة اعطال";
    b.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;background:#2563eb;color:#fff;border:0;" +
      "border-radius:8px;padding:10px 14px;font:bold 13px Arial;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.4)";
    b.onclick = () => { location.href = REPORT_URL; };
    (document.body || document.documentElement).appendChild(b);
  }
  function isHomePage() {
    return /\/dv\/ui\/home\.jsp/i.test(location.pathname) || /pageid=home/i.test(location.search);
  }

  /* ================== BOOT ================== */
  function boot() {
    if (!document.body) { setTimeout(boot, 400); return; }
    if (tryLogin()) { log("🔐 صفحة لوجين — بيدخل…"); return; }
    // صفحة الهوم: زرّ لفتح التقرير + فتح أوتوماتيك مرة واحدة فى الجلسة
    if (isHomePage()) {
      buildHomeButton();
      if (!sessionStorage.getItem("oas_opened")) {
        sessionStorage.setItem("oas_opened", "1");
        setTimeout(() => { log("🏠 صفحة الهوم — بفتح التقرير أوتوماتيك…"); location.href = REPORT_URL; }, 2000);
      }
      return;
    }
    // استنى دروب-ليست السنترالات تظهر ثم اعرض اللوحة
    const iv = setInterval(() => { if (findSelectByOption("الغنايم")) { clearInterval(iv); buildPanel(); } }, 800);
    setTimeout(() => clearInterval(iv), 120000);
    // أدوات كونسول للتشخيص
    window.OAS_dump = () => {
      document.querySelectorAll("select").forEach(s =>
        console.log("SELECT", s.id || s.name, "options:", [...s.options].slice(0, 6).map(o => norm(o.textContent))));
    };
  }
  boot();
})();
