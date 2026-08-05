// ==UserScript==
// @name         WFM Dispatcher — إلغاء المهمة (Cancel)
// @namespace    service-flow.wfm.dispatcher-reassign
// @description  يبدأ من WFM العادى (WorkOrder/faces/Home)، يسجّل الدخول لو لزم، يفتح قائمة المربعات أعلى اليسار ويختار Assignment and Dispatch، ومنها Tasks Queue، يبحث بالـ Service Id، يختار سطر حالته Started/Assigned (مش Completed)، يفتح قائمة السطر ويضغط Cancel، ويأكّد لو ظهرت نافذة تأكيد.
// @version      1.3.0
// @match        https://wfm.te.eg/WorkOrder/*
// @match        https://wfm.te.eg/Dispatcher/*
// @connect      service-flow-menoskar42.replit.app
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// ⚠️ ملحوظة عن التعارض: سكربت «WFM Reporting — Voice Installation Raw Data» شغّال على
// https://wfm.te.eg/WfmReports/* بس. السكربت ده على /WorkOrder/* و/Dispatcher/* — مسارات
// مختلفة فمفيش تداخل على نفس الصفحة. وطابور التنفيذ فى Service-Flow بيمنع أصلاً إن أى
// عمليتين على دومين wfm.te.eg يفتحوا فى نفس الوقت.

(function () {
  "use strict";

  /* ================== CONFIG ================== */
  const USER = "mina109756";
  const PASS = "Mon_oskar11";
  // المدخل: WFM العادى. الدخول المباشر على Dispatcher/faces/UIShell كان بيدّى صفحة بيضا،
  // والطريق الصحيح: WorkOrder/faces/Home ← قائمة المربعات أعلى اليسار ← Assignment and
  // Dispatch (بتوصّل Dispatcher/faces/Home) ← Tasks Queue.
  const WFM_HOME_URL = "https://wfm.te.eg/WorkOrder/faces/Home";
  const DISPATCHER_URL = "https://wfm.te.eg/Dispatcher/faces/Home";
  const SF_API_BASE = "https://service-flow-menoskar42.replit.app"; // دومين Service-Flow
  const SF_TOKEN = "sf-dzs-138-ingest-2026";                        // = DZS_INGEST_TOKEN فى السيرفر
  // الحالات المقبولة للسطر (مش هناخد Completed أبداً)
  const OK_STATUSES = /^(started|assigned)$/i;

  /* ================== أدوات عامة ================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const qAll = (sel, root) => [].slice.call((root || document).querySelectorAll(sel));
  const visible = (el) => { try { return !!el && el.getClientRects().length > 0; } catch (e) { return false; } };
  // \u00a0 (nbsp) شائعة فى قوائم ADF ومش بتتطابق مع \s فى بعض الحالات — بنحوّلها مسافة عادية
  const txt = (el) => ((el && el.textContent) || "").replace(/[\u00a0\u200f\u200e]/g, " ").replace(/\s+/g, " ").trim();
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

  // ADF بيعتّم الشاشة ويقفلها أثناء أى طلب للسيرفر (partial page render). لو قرينا الـ DOM
  // فى اللحظة دى ممكن نقرا حالة قديمة أو نضغط زر متقفل. بنستنى لحد ما يخلّص:
  //   (1) واجهة ADF نفسها لو متاحة (isSynchronizedWithServer)
  //   (2) وإلا وجود طبقة الحجب (BlockingGlass) الظاهرة
  function adfBusy() {
    try {
      const P = window.AdfPage && window.AdfPage.PAGE;
      if (P && typeof P.isSynchronizedWithServer === "function") return !P.isSynchronizedWithServer();
    } catch (e) {}
    return qAllDocs("[class*='BlockingGlass'], .AFBlockingGlassPane").some(visible);
  }
  async function waitIdle(ms) {
    const end = Date.now() + (ms || 20000);
    // نستنى شوية الأول عشان الطلب يكون بدأ فعلاً قبل ما نتأكد إنه خلص
    await sleep(300);
    while (Date.now() < end && adfBusy()) await sleep(250);
    await sleep(200);
  }

  // نوافذ ADF المنبثقة بترسم جوّه طبقة مخصوصة (dataForm::_af_Z_window / AFZOrderLayer)
  // ومعاها maskingframe لما تكون modal. بنستخدمها عشان نحصر البحث عن أزرار النافذة
  // جوّاها بس — بدل ما نمسح الصفحة كلها ونضغط زر من الخلفية بالغلط.
  function adfDialogRoot() {
    const cands = qAllDocs("[role='dialog'], [id$='::_af_Z_window'], .AFZOrderLayer");
    for (const el of cands) {
      if (!visible(el)) continue;
      if (txt(el)) return el;          // فيه محتوى فعلاً (مش طبقة فاضية)
    }
    return null;
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
    console.log("[WFM-CANCEL]", msg);
  }
  function logln(msg) {
    console.log("[WFM-CANCEL]", msg);
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
      '<div style="font-weight:bold;color:#0d47a1;margin-bottom:6px">🚫 إلغاء المهمة (Cancel)</div>' +
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

  // قراءة صفوف النتائج.
  // ⚠️ ADF بيقسّم الجدول لجدولين لما يكون فيه أعمدة مجمّدة (Columns Frozen): جدول للأعمدة
  // المجمّدة وجدول للمتحرّكة. فالبحث عن عمود AssignmentStatus بفهرس العناوين كان بيفشل
  // (العنوان فى جدول والبيانات فى جدول تانى) ويفضل السكربت مستنى النتايج للأبد.
  // الحل: ندوّر على **نص الحالة نفسه** فى أى خلية، ونرجع الصف اللى هى فيه.
  const STATUS_RE = /^(started|assigned|completed|dispatched|cancell?ed|partial completed|blocked|escalated)$/i;
  function readResultRows() {
    const seen = [];
    const rows = [];
    for (const el of qAllDocs("td, div, span")) {
      if (!visible(el)) continue;
      const t = txt(el);
      if (!t || !STATUS_RE.test(t)) continue;
      let tr = null;
      try { tr = el.closest("tr"); } catch (e) {}
      if (!tr || seen.indexOf(tr) >= 0) continue;
      // نتأكد إنه صف بيانات فعلاً (فيه كذا خلية) مش عنصر فى مفتاح الألوان
      if (qAll("td", tr).length < 3) continue;
      seen.push(tr);
      rows.push({ tr, status: t, workOrderId: "" });
    }
    return rows;
  }

  // زر قائمة السطر.
  // ⚠️ فى أول الصف بيبقى فيه أكتر من أيقونة صغيرة: مثلث **توسيع الصف** (disclosure) وأيقونة
  // **قائمة الإجراءات**. الأخذ بالأقصى-شمال كان بيضغط على التوسيع فيفتح تفاصيل الصف بدل
  // القائمة. فبنرتّبهم: اللى شكله قائمة الأول، واللى شكله توسيع/تحديد يتستبعد.
  // أيقونة القائمة شكلها مفتاح/عدّة (wrench) ومعاها سهم صغير — دى اللى بتفتح القائمة.
  // من DevTools: زر القائمة الحقيقى هو <div role="menuitem" aria-haspopup="true">،
  // وجوّاه صورة اسمها WOFunctions (أيقونة المفتاح). العلامة الأقوى هى aria-haspopup.
  const MENU_HINT = /menu|dropdown|action|popup|caret|gear|tool|wrench|key|cmd|oper|wofunction/i;
  const NOT_MENU_HINT = /expand|collapse|disclos|detail|select|checkbox|sort/i;
  function iconMeta(el) {
    const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    return [el.id, el.title, el.getAttribute && el.getAttribute("aria-label"),
      el.getAttribute && el.getAttribute("alt"), el.src, cls].map((x) => String(x || "")).join(" ");
  }
  function findRowMenuButtons(tr) {
    let r; try { r = tr.getBoundingClientRect(); } catch (e) { return null; }
    if (!r || !r.height) return null;
    const mid = r.top + r.height / 2;
    const onRow = (el) => {
      const b = el.getBoundingClientRect();
      return b.top <= mid && b.bottom >= mid;                 // على نفس ارتفاع الصف
    };
    // من DevTools: الـ id بتاع TasksQueueTab موجود على العنصر **الأب** (role="presentation")،
    // و aria-haspopup على العنصر الجوّانى اللى id بتاعه رقم عشوائى. فبندوّر على العنصر
    // اللى بيفتح قائمة فعلاً، وبنحصره فى أقصى شمال الصف (منطقة الأعمدة المجمّدة).
    const leftLimit = r.left + 220;
    const inLeftBand = (el) => el.getBoundingClientRect().left <= leftLimit;

    // (1) الأدق: عنصر بيفتح قائمة منبثقة، على نفس ارتفاع الصف وفى شماله
    const popups = qAllDocs("[aria-haspopup='true'], [role='menuitem']")
      .filter((el) => visible(el) && onRow(el) && inLeftBand(el));
    if (popups.length) {
      lastRowIcons = popups.map((el) => {
        const holder = el.closest ? el.closest("[id*='TasksQueueTab']") : null;
        return String((holder && holder.id) || el.id || "menuitem").slice(0, 60);
      });
      return popups;
    }

    // (2) وإلا: أيقونات صغيرة على نفس ارتفاع الصف — وفى أقصى شماله برضه.
    //     من غير الحد ده كان بيمسك أيقونة من آخر الصف (زى زر الخريطة فى عمود Longitude)
    //     ويفتح «Organization Location» بدل القائمة.
    let cands = qAllDocs("[aria-haspopup='true'], [role='menuitem'], a, button, img, [role='button']").filter((el) => {
      if (!visible(el)) return false;
      const b = el.getBoundingClientRect();
      if (b.width > 80 || b.height > 44) return false;       // أيقونة/زر صغير
      if (!inLeftBand(el)) return false;                      // مش من الأعمدة المجمّدة
      return onRow(el);
    });
    if (!cands.length) return null;
    // تشخيص: لو فشلنا بعدين نبقى عارفين إيه اللى كان موجود
    lastRowIcons = cands.map((el) => (iconMeta(el).trim() || "(بدون وصف)").slice(0, 60));
    const scored = cands.map((el) => {
      const meta = iconMeta(el);
      let score = 0;
      // أقوى علامة: العنصر نفسه بيفتح قائمة منبثقة
      if (el.getAttribute && el.getAttribute("aria-haspopup") === "true") score += 20;
      if (el.getAttribute && el.getAttribute("role") === "menuitem") score += 8;
      if (MENU_HINT.test(meta)) score += 10;
      if (NOT_MENU_HINT.test(meta)) score -= 10;
      return { el, score, left: el.getBoundingClientRect().left };
    });
    scored.sort((a, b) => (b.score - a.score) || (a.left - b.left));
    // بنرجّع كل المرشّحين بالترتيب — أيقونة القائمة أحياناً بتبقى أيقونة + سهم صغير جنبها،
    // فلو الأولى مافتحتش القائمة نجرّب اللى بعدها بدل ما نستسلم.
    return scored.filter((x) => x.score > -10).map((x) => x.el);
  }
  let lastRowIcons = [];

  // هل عنصر القائمة معطّل؟ (ADF بيستخدم كلاس فيه disabled أو aria-disabled)
  function isDisabled(el) {
    if (!el) return true;
    if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return true;
    if (el.disabled) return true;
    let n = el;
    for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
      const cls = String((n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || "");
      if (/disabled/i.test(cls)) return true;
    }
    return false;
  }

  function matchingItems(re) {
    return qAllDocs("[role='menuitem'], a, div, span, li, td").filter((el) => {
      if (!visible(el)) return false;
      const t = txt(el);
      return t && t.length <= 40 && re.test(t);
    });
  }
  // ADF بيرسم عنصر القائمة كـ <tr role="menuitem"> جوّاه <td>Cancel</td> — الضغط لازم
  // يكون على الصف (اللى شايل الـ handler) مش على الخلية.
  function menuTarget(el) {
    if (!el) return null;
    try {
      const mi = el.closest("[role='menuitem']");
      if (mi) return mi;
      if (el.tagName === "TD") return el.closest("tr") || el;
    } catch (e) {}
    return el;
  }
  // «Cancel» موجودة كمان كزر عادى فى مكان تانى فى الصفحة — فبناخد **اللى ظهر جديد**
  // بعد فتح قائمة السطر بس، عشان مانضغطش على زر غلط.
  function findNewMenuItem(re, before) {
    const hit = matchingItems(re).find((el) => before.indexOf(el) < 0);
    return hit ? menuTarget(hit) : null;
  }

  // شاشة البحث اللى بنشتغل عليها هى «Tasks Queue» — مش الصفحة الافتراضية
  // (Assignment and Dispatch). بندخل من faces/Home وبعدين نفتح القائمة ونختارها.
  function findMenuToggle() {
    return qAllDocs("a, button, div, span, img").find((el) => {
      if (!visible(el)) return false;
      const meta = [el.id, el.title, el.getAttribute && el.getAttribute("aria-label"),
        (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className)]
        .map((x) => String(x || "")).join(" ");
      if (/menu|hamburger|navigat/i.test(meta)) return true;
      return /^[\u2630\u2261]$/.test(txt(el));   // ☰ أو ≡
    }) || null;
  }

  // اختيار عنصر من القائمة العلوية بمحاولات — بنفتح القائمة لو مش مفتوحة.
  // المطابقة بالاحتواء مش بالتطابق التام: نص العنصر ممكن يجى معاه أيقونة/مسافات.
  async function clickMenuEntry(re, label) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let item = findByText("a, span, div, li, td", re, 40);
      if (!item) {
        const burger = findMenuToggle();
        if (burger) { logln("☰ بفتح القائمة…"); fireClick(burger); await sleep(1500); }
        item = await waitFor(() => findByText("a, span, div, li, td", re, 40), 8000);
      }
      if (item) {
        logln("📂 بفتح «" + label + "»…");
        fireClick(menuTarget(item));
        await waitIdle(25000);
        return true;
      }
      logln("… محاولة " + attempt + ": مش لاقى «" + label + "» فى القائمة.");
      await sleep(1200);
    }
    return false;
  }

  // مبدّل التطبيقات = أيقونة المربعات أعلى **يسار** الهيدر (جنب لوجو HIVE WORX). مالهاش
  // نص ولا aria-label ثابت، فبنجمع العناصر الصغيرة اللى فى الركن الأعلى الأيسر ونجرّبها
  // واحد ورا التانى، وبعد كل ضغطة بنتأكد هل ظهرت «Assignment and Dispatch» ولا لأ.
  function topLeftCandidates() {
    return qAllDocs("a, button, div, span, img, td").filter((el) => {
      if (!visible(el)) return false;
      let r; try { r = el.getBoundingClientRect(); } catch (e) { return false; }
      if (r.top > 140 || r.left > 160) return false;
      if (r.width < 8 || r.height < 8 || r.width > 90 || r.height > 90) return false;
      return true;
    }).sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (ra.left + ra.top) - (rb.left + rb.top);
    }).slice(0, 12);
  }
  function describeEl(el) {
    const r = el.getBoundingClientRect();
    const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || "");
    return el.tagName + (el.id ? "#" + el.id : "") + (cls ? "." + String(cls).split(/\s+/)[0] : "") +
      " @" + Math.round(r.left) + "," + Math.round(r.top);
  }
  const findDispatchEntry = () => findByText("a, span, div, li, td", /assignment\s*and\s*dispatch/i, 60);

  // من WFM العادى لتطبيق Dispatcher. بيرجّع "navigating" لو ضغط ودور التحميل جاى،
  // و true لو إحنا أصلاً على Dispatcher، و false لو مالقاش الزر.
  async function gotoDispatcherApp() {
    if (/\/Dispatcher\//i.test(location.pathname)) return true;
    let item = findDispatchEntry();
    if (!item) {
      const burger = findMenuToggle();
      if (burger) { logln("☰ بفتح القائمة…"); fireClick(burger); await sleep(1200); item = findDispatchEntry(); }
    }
    if (!item) {
      for (const c of topLeftCandidates()) {
        logln("🔳 بجرّب زر أعلى اليسار: " + describeEl(c));
        fireClick(c);
        await sleep(1200);
        item = findDispatchEntry();
        if (item) break;
      }
    }
    if (!item) { logln("❌ مش لاقى «Assignment and Dispatch» فى قائمة المربعات."); return false; }
    logln("📂 بفتح «Assignment and Dispatch»…");
    fireClick(menuTarget(item));
    return "navigating";   // بتحمّل صفحة Dispatcher — السكربت بيكمّل عليها من الأول
  }

  // شاشة البحث اللى بنشتغل عليها هى «Tasks Queue». على Dispatcher/faces/Home بتبقى
  // مربّع ظاهر، ولو إحنا على شاشة تانية بنعدّى على Home الأول.
  async function gotoTasksQueue() {
    if (findServiceIdInput()) return true;           // إحنا عليها أصلاً
    await clickMenuEntry(/^\s*home\s*$/i, "Home");
    await sleep(1000);
    if (findServiceIdInput()) return true;
    if (!(await clickMenuEntry(/tasks\s*queue/i, "Tasks Queue"))) return false;
    return !!(await waitFor(() => findServiceIdInput(), 25000));
  }

  // تبليغ Service-Flow بنتيجة الإلغاء. بنتحقّق من r.ok فعلاً — لو السيرفر رفض بنقول،
  // مانفترضش النجاح.
  async function sfReportCancel(phone, status) {
    try {
      const r = await window.fetch(SF_API_BASE.replace(/\/+$/, "") + "/api/wfm-tasks/cancel-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DZS-Token": SF_TOKEN },
        body: JSON.stringify({ phone: String(phone || "").replace(/\D/g, ""), status: status || "" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) return { ok: false, error: (j && j.message) || ("HTTP " + r.status) };
      return { ok: true };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }

  /* ================== التدفّق الرئيسى ================== */
  const PENDING_KEY = "sf_wfm_cancel_pending";
  let running = false;
  // بيتحطّ true لما نكون بننقل لصفحة تانية — ساعتها بنسيب الرقم محفوظ عشان السكربت
  // يكمّل عليه بعد التحميل بدل ما يضيع.
  let navigating = false;
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

      // (2) لو إحنا على WFM العادى → قائمة المربعات ← Assignment and Dispatch (بتودّينا
      //     Dispatcher/faces/Home)، والسكربت بيكمّل بعد ما الصفحة الجديدة تحمّل.
      let sidInput = findServiceIdInput();
      if (!sidInput && !/\/Dispatcher\//i.test(location.pathname)) {
        banner("🔳 بفتح Assignment and Dispatch…");
        const nav = await gotoDispatcherApp();
        if (nav === "navigating") { navigating = true; return; }   // الرقم محفوظ — نكمّل بعد التحميل
        if (!nav) { navigating = true; location.href = DISPATCHER_URL; return; }
      }

      // (3) شاشة «Tasks Queue» هى اللى فيها خانة Service Id — لو مش عليها نفتحها من القائمة
      sidInput = findServiceIdInput();
      if (!sidInput) {
        banner("📂 بفتح Tasks Queue…");
        if (!(await gotoTasksQueue())) {
          banner("❌ تعذّر فتح شاشة Tasks Queue.", "#c62828");
          return;
        }
        sidInput = findServiceIdInput();
        if (!sidInput) { banner("❌ مش لاقى خانة Service Id.", "#c62828"); return; }
      }

      // (3) اكتب الرقم فى Service Id واضغط Search
      banner("⌨️ إدخال Service Id…");
      setValue(sidInput, serviceId);
      await sleep(500);
      const searchBtn = findSearchButton();
      if (!searchBtn) { banner("❌ مش لاقى زر Search.", "#c62828"); return; }
      fireClick(searchBtn);
      logln("🔍 اتضغط Search…");
      await waitIdle(25000);   // ADF بيعتّم الشاشة لحد ما النتايج ترجع

      // (4) استنى النتائج تظهر (صفوف فيها حالة) — مش مهلة ثابتة
      banner("⏳ فى انتظار النتائج…");
      const rows = await waitFor(() => {
        const r = readResultRows();
        return r.length ? r : null;
      }, 25000);
      if (!rows) {
        banner("• مفيش نتائج للرقم " + serviceId + ".", "#ef6c00");
        const hasNoRows = /no\s*rows\s*found|no\s*data/i.test(document.body.innerText || "");
        logln(hasNoRows ? "• الجدول رجّع «No rows found»." : "• معرفتش أقرا صفوف النتايج — راجع شكل الجدول.");
        return;
      }
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
        const menuBtns = findRowMenuButtons(row.tr);
        if (!menuBtns.length) { logln("   … مش لاقى أيقونة القائمة."); continue; }
        let item = null;
        for (let k = 0; k < Math.min(menuBtns.length, 3) && !item; k++) {
          const before = matchingItems(/^\s*cancel\s*$/i);   // «Cancel» الموجودة قبل فتح القائمة
          fireClick(menuBtns[k]);
          await waitIdle(8000);
          item = await waitFor(() => findNewMenuItem(/^\s*cancel\s*$/i, before), 5000);
          if (!item && k + 1 < Math.min(menuBtns.length, 3)) {
            logln("   … الأيقونة " + (k + 1) + " مافتحتش القائمة — بجرّب اللى بعدها.");
            try { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
            await sleep(600);
          }
        }
        if (!item) {
          logln("   … القائمة مافتحتش أو مفيش Cancel.");
          if (lastRowIcons.length) logln("   🔎 أيقونات الصف: " + lastRowIcons.join(" | "));
          continue;
        }
        if (isDisabled(item)) {
          logln("   ⚠️ Cancel معطّلة فى السطر ده — بجرّب اللى بعده.");
          try { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
          await sleep(600);
          continue;
        }
        fireClick(item);
        await waitIdle(15000);
        logln("   ✅ اتضغط Cancel.");
        opened = true;
        break;
      }
      if (!opened) { banner("⚠️ Cancel مش متاحة فى أى سطر مؤهّل.", "#ef6c00"); return; }

      // (7) بعض الشاشات بتطلب تأكيد بعد Cancel — لو ظهرت نافذة تأكيد نضغط الموافقة.
      //     مش كل الحالات بتطلبها، فلو مظهرتش نكمّل عادى.
      await sleep(1200);
      const dlg = adfDialogRoot();
      const CONFIRM_RE = /^\s*(yes|ok|confirm|submit|نعم|موافق|تأكيد)\s*$/i;
      const confirmBtn = dlg
        ? qAll("button, a, input[type='submit'], span[role='button'], [role='menuitem']", dlg)
            .find((el) => visible(el) && CONFIRM_RE.test(txt(el)))
        : findByText("button, a, input[type='submit'], span[role='button']", CONFIRM_RE, 20);
      if (dlg) logln("🪟 اتفتحت نافذة تأكيد.");
      if (confirmBtn && !isDisabled(confirmBtn)) {
        fireClick(confirmBtn);
        logln("✅ اتضغط زر التأكيد (" + txt(confirmBtn) + ").");
        await sleep(1200);
      } else {
        logln("ℹ️ مفيش نافذة تأكيد — الإلغاء اتنفّذ مباشرةً.");
      }

      // (8) نتأكد إن الحالة اتغيّرت فعلاً بدل ما نفترض النجاح: نعيد قراءة الجدول
      await waitIdle(15000);
      const after = await waitFor(() => {
        const r = readResultRows();
        return r.length ? r : null;
      }, 10000) || [];
      const stillOk = after.filter((r) => OK_STATUSES.test(r.status.trim())).length;
      logln("📋 بعد الإلغاء: " + (after.length ? after.map((r) => r.status).join(" ، ") : "(الجدول فاضى)"));
      if (stillOk < candidates.length) {
        // بنبلّغ Service-Flow إن الإلغاء اتم — السيرفر بيسجّل «مين طلبه» من op_intents
        // (نفس أسلوب القياس ورفع السرعة) عشان يظهر فى سجل العمليات.
        const rep = await sfReportCancel(serviceId, (candidates[0] && candidates[0].status) || "");
        banner("✅ تم إلغاء المهمة للرقم " + serviceId + "." + (rep.ok ? "" : " (⚠️ التسجيل فى Service-Flow فشل: " + rep.error + ")"),
               rep.ok ? "#2e7d32" : "#ef6c00");
      } else {
        banner("⚠️ اتضغط Cancel بس حالة السطر ما اتغيّرتش — راجع الشاشة.", "#ef6c00");
      }
    } catch (e) {
      banner("❌ خطأ: " + (e && e.message || e), "#c62828");
      logln("❌ " + (e && e.stack || e));
    } finally {
      running = false;
      // خلصنا (نجاح أو فشل) → امسح الرقم المحفوظ عشان مايتنفّذش تانى لوحده عند أى تحميل.
      // لو إحنا بننقل لصفحة تانية بنسيبه عشان السكربت يكمّل عليه هناك.
      if (!navigating) { try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {} }
    }
  }

  /* ================== البداية ================== */
  function boot() {
    if (!document.body) { setTimeout(boot, 300); return; }
    buildPanel();
    banner("⚙️ Dispatcher Cancel — اكتب Service Id واضغط ابدأ.");
    // تشغيل تلقائى لو الرقم اتبعت فى الهاش: #sf_cancel=2653614
    // ملحوظة: المتصفح/التطبيق ممكن يرمّز علامة «=» لـ «%3D» — فبنقبل الاتنين.
    // وبنخزّن الرقم فى sessionStorage عشان يفضل موجود بعد ما ADF يغيّر الهاش أثناء التنقّل.
    const m = (location.hash || "").match(/sf_(?:reassign|cancel)(?:=|%3D)(\d+)/i);
    let pending = m ? m[1] : "";
    if (pending) { try { sessionStorage.setItem(PENDING_KEY, pending); } catch (e) {} }
    else { try { pending = sessionStorage.getItem(PENDING_KEY) || ""; } catch (e) {} }
    // الرقم بيفضل محفوظ لحد ما التدفّق يخلص فعلاً (runFlow بيمسحه) — عشان يعدّى معانا
    // من WorkOrder لـ Dispatcher من غير ما يضيع.
    // صفحة Dispatcher بيضا (بتحصل لو دخلنا عليها مباشرةً من غير ما نعدّى على WFM العادى):
    // نرجع للمدخل الصحيح والسكربت بيكمّل من هناك بالرقم المحفوظ.
    if (pending && /\/Dispatcher\//i.test(location.pathname) && txt(document.body).length < 40) {
      logln("⬜ صفحة Dispatcher فاضية — بأرجع لمدخل WFM العادى.");
      location.href = WFM_HOME_URL;
      return;
    }
    if (pending) {
      const inp = panel && panel.querySelector("#sfrsInput");
      if (inp) inp.value = pending;
      setTimeout(() => runFlow(pending), 1800);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 800));
  else setTimeout(boot, 800);
})();
