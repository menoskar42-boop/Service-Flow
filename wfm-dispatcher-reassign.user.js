// ==UserScript==
// @name         WFM Dispatcher — Re-assign بتاريخ اليوم
// @namespace    service-flow.wfm.dispatcher-reassign
// @description  يفتح Dispatcher على wfm.te.eg، يسجّل الدخول لو ظهرت شاشة اللوجين، يبحث بالـ Service Id، يختار سطر حالته Started/Assigned (مش Completed)، يفتح قائمة السطر ويضغط Re-assign، يضبط التاريخ على تاريخ اليوم، ثم Assign.
// @version      1.0.0
// @match        https://wfm.te.eg/Dispatcher/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// ⚠️ ملحوظة عن التعارض: سكربت «WFM Reporting — Voice Installation Raw Data» شغّال على
// https://wfm.te.eg/WfmReports/* بس. السكربت ده على /Dispatcher/* بس — مسارين مختلفين
// فمفيش أى تداخل، ومش هيشتغلوا مع بعض على نفس الصفحة أبداً.

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mina109756";
  const PASS = "Mon_oskar11";
  const DISPATCHER_URL = "https://wfm.te.eg/Dispatcher/faces/UIShell";
  // الحالات المقبولة للسطر (مش هناخد Completed أبداً)
  const OK_STATUSES = /^(started|assigned)$/i;

  /* ================== أدوات عامة ================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const qAll = (sel, root) => [].slice.call((root || document).querySelectorAll(sel));
  const visible = (el) => { try { return !!el && el.getClientRects().length > 0; } catch (e) { return false; } };
  const txt = (el) => ((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  const norm = (s) => (s || "").toLowerCase().replace(/[\s_:]+/g, "");

  async function waitFor(fn, ms, step) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) {}
      await sleep(step || 300);
    }
    return null;
  }

  // كل الـ documents (الصفحة + أى iframes من نفس الأصل) — ADF بيحط حاجات فى frames
  function docs() {
    const out = [document];
    const walk = (root) => {
      let ifr = [];
      try { ifr = qAll("iframe, frame", root); } catch (e) {}
      for (const f of ifr) {
        let d = null; try { d = f.contentDocument; } catch (e) {}
        if (d && out.indexOf(d) === -1) { out.push(d); walk(d); }
      }
    };
    walk(document);
    return out;
  }
  const qAllDocs = (sel) => docs().reduce((a, d) => a.concat(qAll(sel, d)), []);

  function findByText(sel, re, maxLen) {
    const lim = maxLen || 60;
    return qAllDocs(sel).find((el) => {
      if (!visible(el)) return false;
      const t = txt(el);
      return t && t.length <= lim && re.test(t);
    }) || null;
  }

  function fireClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    }
    if (typeof el.click === "function") { try { el.click(); } catch (e) {} }
    else { try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch (e) {} }
    return true;
  }

  // ADF بيسمع لـ input/change وبيتحقق عند blur — لازم الثلاثة عشان القيمة تثبت
  function setValue(el, val) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, val); else el.value = val;
    for (const type of ["input", "change"]) {
      try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) {}
    }
    try { el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true })); } catch (e) {}
    try { el.blur(); } catch (e) {}
  }

  // تاريخ اليوم بصيغة الشاشة: dd-MM-yyyy (زى 05-08-2026)
  function todayDDMMYYYY() {
    const d = new Date(); const p = (n) => String(n).padStart(2, "0");
    return p(d.getDate()) + "-" + p(d.getMonth() + 1) + "-" + d.getFullYear();
  }
  // مقارنة تاريخين مهما كان الفاصل (- أو /) — بنقارن الأرقام نفسها
  function sameDay(str) {
    const nums = String(str || "").match(/\d+/g);
    if (!nums || nums.length < 3) return false;
    const d = new Date(); const p = (n) => String(n).padStart(2, "0");
    const want = [p(d.getDate()), p(d.getMonth() + 1), String(d.getFullYear())];
    const got = nums.map((x) => (x.length === 4 ? x : x.padStart(2, "0")));
    // نقبل dd-MM-yyyy أو yyyy-MM-dd
    return (got[0] === want[0] && got[1] === want[1] && got[2] === want[2])
        || (got[0] === want[2] && got[1] === want[1] && got[2] === want[0]);
  }

  /* ================== واجهة السكربت ================== */
  let bar, logBox, panel;
  function banner(msg, color) {
    if (!document.body) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 12px;" +
        "font:bold 13px Arial;color:#fff;background:#0d47a1;text-align:center;direction:rtl;box-shadow:0 2px 8px rgba(0,0,0,.4)";
      document.body.appendChild(bar);
    }
    bar.style.background = color || "#0d47a1";
    bar.textContent = msg;
    console.log("[REASSIGN]", msg);
  }
  function logln(msg) {
    console.log("[REASSIGN]", msg);
    if (!logBox) return;
    const d = document.createElement("div");
    d.textContent = msg;
    logBox.appendChild(d);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function buildPanel() {
    if (panel || !document.body) return;
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;width:340px;" +
      "background:#fff;border:2px solid #0d47a1;border-radius:10px;padding:10px;direction:rtl;" +
      "font:13px Arial;box-shadow:0 4px 16px rgba(0,0,0,.3)";
    panel.innerHTML =
      '<div style="font-weight:bold;color:#0d47a1;margin-bottom:6px">🔁 إعادة إسناد المهمة (Re-assign)</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      '  <input id="sfrsInput" placeholder="Service Id (مثال: 2653614)" ' +
      '     style="flex:1;padding:6px;border:1px solid #bbb;border-radius:6px;font:13px Arial" />' +
      '  <button id="sfrsGo" style="padding:6px 12px;border:0;border-radius:6px;background:#0d47a1;color:#fff;font-weight:bold;cursor:pointer">ابدأ</button>' +
      '</div>' +
      '<div id="sfrsLog" style="max-height:150px;overflow:auto;background:#f6f8fa;border-radius:6px;padding:6px;font:12px monospace;color:#333"></div>';
    document.body.appendChild(panel);
    logBox = panel.querySelector("#sfrsLog");
    const input = panel.querySelector("#sfrsInput");
    const go = panel.querySelector("#sfrsGo");
    go.addEventListener("click", () => {
      const v = String(input.value || "").replace(/\D/g, "").trim();
      if (!v) { banner("❌ اكتب Service Id الأول.", "#c62828"); return; }
      runFlow(v);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  }

  /* ================== تسجيل الدخول ================== */
  function onLoginPage() {
    return qAllDocs("input[type='password']").some(visible);
  }
  async function doLogin() {
    const pass = await waitFor(() => qAllDocs("input[type='password']").find(visible) || null, 20000);
    if (!pass) return false;
    const all = qAllDocs("input").filter(visible);
    const user = all.slice(0, all.indexOf(pass)).reverse()
      .find((i) => !/password/i.test(i.type || "")) || all[0];
    banner("🔐 تسجيل الدخول…");
    if (user) setValue(user, USER);
    setValue(pass, PASS);
    await sleep(400);
    const btn = findByText("button, input[type='submit'], a", /^\s*(login|sign\s*in|دخول)\s*$/i, 25)
             || qAllDocs("button, input[type='submit']").find(visible);
    if (btn) fireClick(btn);
    else { try { pass.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })); } catch (e) {} }
    // بعد الدخول الصفحة بتعيد التحميل — نستنى شاشة الـ Dispatcher تظهر
    return !!(await waitFor(() => !onLoginPage() && findServiceIdInput(), 30000));
  }

  /* ================== عناصر شاشة Dispatcher ================== */
  // خانة Service Id: بندوّر على العنوان ثم أقرب input ليه (ADF بيحط label جنب الحقل)
  function findServiceIdInput() {
    for (const d of docs()) {
      const labels = qAll("label, span, div, td", d).filter((el) => {
        const t = norm(txt(el));
        return t === "serviceid" && txt(el).length <= 20;
      });
      for (const lb of labels) {
        // input جوّه نفس الحاوية أو فى العنصر اللى بعده
        const cands = [];
        let p = lb.parentElement;
        for (let i = 0; i < 4 && p; i++, p = p.parentElement) cands.push(...qAll("input[type='text'], input:not([type])", p));
        let sib = lb.nextElementSibling;
        for (let i = 0; i < 3 && sib; i++, sib = sib.nextElementSibling) cands.push(...qAll("input[type='text'], input:not([type])", sib), ...(sib.tagName === "INPUT" ? [sib] : []));
        const inp = cands.find(visible);
        if (inp) return inp;
      }
    }
    return null;
  }

  function findSearchButton() {
    return findByText("button, a, input[type='submit'], span[role='button']", /^\s*search\s*$/i, 20)
        || qAllDocs("input[type='submit'][value='Search'], button[title='Search']").find(visible)
        || null;
  }

  // جدول النتائج + فهارس الأعمدة المهمة
  function readResultRows() {
    for (const d of docs()) {
      for (const tbl of qAll("table", d)) {
        const heads = qAll("th", tbl).map((th) => norm(txt(th)));
        if (!heads.length) continue;
        const iStatus = heads.findIndex((h) => h.indexOf("assignmentstatus") >= 0);
        const iWo = heads.findIndex((h) => h.indexOf("workorderid") >= 0);
        if (iStatus < 0) continue;
        const rows = [];
        for (const tr of qAll("tr", tbl)) {
          const tds = qAll("td", tr);
          if (!tds.length) continue;
          const status = tds[iStatus] ? txt(tds[iStatus]) : "";
          if (!status) continue;
          rows.push({
            tr,
            status,
            workOrderId: iWo >= 0 && tds[iWo] ? txt(tds[iWo]) : "",
          });
        }
        if (rows.length) return rows;
      }
    }
    return [];
  }

  // سهم القائمة فى بداية السطر (ADF بيرسمه كأيقونة/زر صغير فى أول خلية)
  function findRowMenuButton(tr) {
    const cells = qAll("td", tr).slice(0, 3);
    for (const td of cells) {
      const btn = qAll("a, button, img, span, div", td).find((el) => {
        if (!visible(el)) return false;
        const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || "";
        const t = (el.title || el.getAttribute("aria-label") || "") + " " + cls;
        return /menu|dropdown|arrow|caret|action|popup/i.test(String(t));
      });
      if (btn) return btn;
      // احتياطى: أول عنصر قابل للضغط فى الخلية
      const any = qAll("a, button", td).find(visible);
      if (any) return any;
    }
    return null;
  }

  // هل عنصر القائمة معطّل؟ (ADF بيستخدم كلاس فيه disabled أو aria-disabled)
  function isDisabled(el) {
    if (!el) return true;
    if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return true;
    if (el.disabled) return true;
    let n = el;
    for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
      const cls = String((n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || "");
      if (/disabled/i.test(cls)) return true;
    }
    return false;
  }

  function findMenuItem(re) {
    return qAllDocs("a, div, span, li, td").find((el) => {
      if (!visible(el)) return false;
      const t = txt(el);
      return t && t.length <= 40 && re.test(t);
    }) || null;
  }

  /* ================== التدفّق الرئيسى ================== */
  let running = false;
  async function runFlow(serviceId) {
    if (running) { banner("⏳ فيه عملية شغّالة بالفعل…", "#ef6c00"); return; }
    running = true;
    try {
      banner("🔎 Service Id " + serviceId + " — جارٍ البدء…");
      logln("▶️ بدء المعالجة للرقم " + serviceId);

      // (1) لو شاشة لوجين → ادخل
      if (onLoginPage()) {
        if (!(await doLogin())) { banner("⛔ تعذّر تسجيل الدخول.", "#c62828"); return; }
        logln("✅ تم تسجيل الدخول.");
      }

      // (2) اتأكد إننا على شاشة Dispatcher
      let sidInput = findServiceIdInput();
      if (!sidInput) {
        logln("↪️ مش على شاشة Dispatcher — بفتحها…");
        location.href = DISPATCHER_URL;
        return; // الصفحة هتتحمّل من جديد والسكربت هيشتغل تانى
      }

      // (3) اكتب الرقم فى Service Id واضغط Search
      banner("⌨️ إدخال Service Id…");
      setValue(sidInput, serviceId);
      await sleep(500);
      const searchBtn = findSearchButton();
      if (!searchBtn) { banner("❌ مش لاقى زر Search.", "#c62828"); return; }
      fireClick(searchBtn);
      logln("🔍 اتضغط Search…");

      // (4) استنى النتائج تظهر (صفوف فيها حالة) — مش مهلة ثابتة
      banner("⏳ فى انتظار النتائج…");
      const rows = await waitFor(() => {
        const r = readResultRows();
        return r.length ? r : null;
      }, 25000);
      if (!rows) { banner("• مفيش نتائج للرقم " + serviceId + ".", "#ef6c00"); logln("• الجدول رجع فاضى."); return; }
      logln("📋 " + rows.length + " سطر: " + rows.map((r) => r.status).join(" ، "));

      // (5) الأسطر المقبولة: Started / Assigned فقط (مش Completed)
      const candidates = rows.filter((r) => OK_STATUSES.test(r.status.trim()));
      if (!candidates.length) {
        banner("• مفيش سطر حالته Started أو Assigned (الموجود: " + rows.map((r) => r.status).join(" ، ") + ").", "#ef6c00");
        return;
      }
      logln("✅ " + candidates.length + " سطر مؤهّل.");

      // (6) نجرّب سطر سطر: نفتح قائمته وندوّر على Re-assign — لو معطّلة ننتقل للى بعده
      let opened = false;
      for (let i = 0; i < candidates.length; i++) {
        const row = candidates[i];
        logln("↪️ سطر " + (i + 1) + " (" + row.status + (row.workOrderId ? " / WO " + row.workOrderId : "") + ")");
        const menuBtn = findRowMenuButton(row.tr);
        if (!menuBtn) { logln("   … مش لاقى سهم القائمة."); continue; }
        fireClick(menuBtn);
        const item = await waitFor(() => findMenuItem(/^\s*re-?\s*assign\s*$/i), 6000);
        if (!item) { logln("   … القائمة مافتحتش أو مفيش Re-assign."); continue; }
        if (isDisabled(item)) {
          logln("   ⚠️ Re-assign معطّلة فى السطر ده — بجرّب اللى بعده.");
          try { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
          await sleep(600);
          continue;
        }
        fireClick(item);
        logln("   ✅ اتضغط Re-assign.");
        opened = true;
        break;
      }
      if (!opened) { banner("⚠️ Re-assign مش متاحة فى أى سطر مؤهّل.", "#ef6c00"); return; }

      // (7) نافذة «Cancel Dispatch then Re-assign Task To»
      banner("⏳ فى انتظار نافذة إعادة الإسناد…");
      const dlgOk = await waitFor(() => /re-?\s*assign\s+task\s+to/i.test(document.body.innerText || ""), 12000);
      if (!dlgOk) { banner("❌ نافذة إعادة الإسناد مافتحتش.", "#c62828"); return; }

      // (8) خانة التاريخ (* On) — نتأكد إنها تاريخ اليوم، وإلا نظبطها
      const dateInp = await waitFor(() => {
        const cands = qAllDocs("input[type='text'], input:not([type])").filter(visible);
        // خانة التاريخ = اللى قيمتها على شكل تاريخ
        return cands.find((i) => /^\s*\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\s*$/.test(String(i.value || ""))) || null;
      }, 8000);
      if (dateInp) {
        const cur = String(dateInp.value || "").trim();
        if (sameDay(cur)) {
          logln("📅 التاريخ تاريخ اليوم بالفعل (" + cur + ").");
        } else {
          const want = todayDDMMYYYY();
          logln("📅 التاريخ كان " + cur + " → بغيّره لـ " + want + ".");
          setValue(dateInp, want);
          await sleep(600);
          if (!sameDay(dateInp.value)) logln("⚠️ التاريخ مااتغيّرش (" + dateInp.value + ") — كمّل بحذر.");
        }
      } else {
        logln("⚠️ مش لاقى خانة التاريخ — هكمّل من غير تعديلها.");
      }

      // (9) Assign
      await sleep(400);
      const assignBtn = findByText("button, a, input[type='submit'], span[role='button']", /^\s*assign\s*$/i, 20);
      if (!assignBtn) { banner("❌ مش لاقى زر Assign.", "#c62828"); return; }
      fireClick(assignBtn);
      logln("🚀 اتضغط Assign.");

      // (10) نتأكد إن النافذة قفلت (علامة نجاح) بدل ما نفترض
      const closed = await waitFor(() => !/re-?\s*assign\s+task\s+to/i.test(document.body.innerText || ""), 12000);
      if (closed) {
        banner("✅ تمت إعادة الإسناد للرقم " + serviceId + " بتاريخ اليوم.", "#2e7d32");
        logln("✅ خلص — النافذة اتقفلت.");
      } else {
        banner("⚠️ اتضغط Assign بس النافذة لسه مفتوحة — راجع الشاشة.", "#ef6c00");
        logln("⚠️ النافذة مااتقفلتش خلال المهلة.");
      }
    } catch (e) {
      banner("❌ خطأ: " + (e && e.message || e), "#c62828");
      logln("❌ " + (e && e.stack || e));
    } finally {
      running = false;
    }
  }

  /* ================== البداية ================== */
  function boot() {
    if (!document.body) { setTimeout(boot, 300); return; }
    buildPanel();
    banner("⚙️ Dispatcher Re-assign — اكتب Service Id واضغط ابدأ.");
    // تشغيل تلقائى لو الرقم اتبعت فى الهاش: #sf_reassign=2653614
    const m = (location.hash || "").match(/sf_reassign=(\d+)/);
    if (m) {
      const v = m[1];
      const inp = panel && panel.querySelector("#sfrsInput");
      if (inp) inp.value = v;
      setTimeout(() => runFlow(v), 1500);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 800));
  else setTimeout(boot, 800);
})();
