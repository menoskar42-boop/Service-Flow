// ==UserScript==
// @name         OAS 430D Details Auto (Service-Flow)
// @namespace    service-flow.oas
// @description  أتمتة تقرير 430D القطاع-TEDATA - Details على Oracle Analytics (we-oas): لوجين + اختيار السنترال (select) + التاريخ (أول الشهر→اليوم) + Apply + تصدير Excel للتفاصيل وتفاصيل المتبقى. v0.2 — إلغاء اختيار القطاع/المنطقة (كل السنترالات بتظهر بدونهم). نصف-أوتوماتيك بلوحة تحكم.
// @version      0.2.0
// @match        https://we-oas.te.eg/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mena.haleem";
  const PASS = "Mon_oskar352";
  const GROUP  = "قطاع وسط الصعيد";
  const REGION = "منطقة تليفونات أسيوط";
  const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];
  const TAB_DETAILS   = "التفاصيل";
  const TAB_REMAINING = "تفاصيل متبقى";

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

  /* ================== LOGIN ================== */
  function tryLogin() {
    const pw = document.querySelector("input[type='password']");
    if (!pw || !visible(pw)) return false;
    const uf = document.querySelector("input[type='text']:not([type='hidden']), input[name*='user' i], input[id*='user' i]");
    if (uf) setInputValue(uf, USER);
    setInputValue(pw, PASS);
    const btn = [...document.querySelectorAll("button, input[type='submit'], a, span")]
      .find(b => visible(b) && /log ?in|sign ?in|دخول|submit/i.test((b.textContent || "") + " " + (b.value || "")));
    setTimeout(() => {
      if (btn) { btn.click(); log("🔐 login submitted"); }
      else { const f = pw.closest("form"); if (f) f.submit(); }
    }, 600);
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
      '<div style="font-weight:bold;margin-bottom:6px">📊 OAS 430D — تشغيل (v0.1)</div>' +
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

  /* ================== BOOT ================== */
  function boot() {
    if (!document.body) { setTimeout(boot, 400); return; }
    if (tryLogin()) { log("🔐 صفحة لوجين — بيدخل…"); return; }
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
