// ==UserScript==
// @name         WFM Dispatcher — إلغاء المهمة (Cancel)
// @namespace    service-flow.wfm.dispatcher-reassign
// @description  إلغاء إسناد مهمة WFM أو إسنادها لفنى آخر. يبدأ من WFM العادى، يدخل Dispatcher ← Tasks Queue، يبحث بالـ Service Id، يختار سطر مش Completed، يفتح قائمة السطر ويضغط Cancel أو Re-assign حسب الوضع المطلوب من Service-Flow. فى وضع Re-assign بيظبط تاريخ النهاردة وكود العامل (ولو غلط يفتح المكبّر ← Search ← OK) ويضغط Assign. كل خطوة بتتحقق من نتيجتها قبل اللى بعدها. v1.5.8: الريفريش بقى بيحافظ على الهاش (كان بيتمسح فالعدّادات مابتتصفّرش والريفريش مايفيدش)، وأى تحميل جديد على صفحة الدخول بيصفّر عدّادات التنقّل. v1.5.7: ممنوع أى ريفريش بعد تنفيذ Cancel/Assign — التحقق بضغطة Search بس. v1.5.6: مافيش افتراض إن الوضع «إلغاء» — لو sf_mode ضاع بيوقف ويقول، بدل ما يحوّل طلب «إسناد لفنى» لـ «إلغاء» فى صمت. v1.5.5: لو صفحة WorkOrder علقت والتنقّل لـ Dispatcher ماحصلش، السكربت بيعمل الريفريش بنفسه (لحد مرتين) بدل ما تعمله بإيدك. v1.5.4: عدّاد الدخول المباشر بقى مؤقّت (دقيقة) بدل ما يعيش طول عمر التاب — كان بيتخطّى الدخول المباشر بسبب تشغيلة قديمة فتعلق الشاشة لحد ما تعمل ريفريش. وأى تنقّل بيتراقب: لو ماحصلش خلال 4 ثوانى بيعيد المحاولة. v1.5.3: بيعيد البحث بنفس الرقم قبل ما يحكم على النتيجة — جدول WFM مابيتحدّثش لوحده بعد Cancel/Assign والحالة الجديدة مابتظهرش غير بعد إعادة تحميل. v1.5.1: رسالة WFM بتفضل ظاهرة 4 ثوانى (DIALOG_SHOW_MS) قبل ضغط OK.
// @version      1.5.8
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
  // الشرط الوحيد على السطر: مايكونش Completed. أى حالة تانية (Started / Assigned /
  // Dispatched / Blocked / Escalated / …) مقبولة — WFM هو اللى بيحكم لو العملية
  // ممكنة ولا لأ، وإحنا بنقرا نتيجته بدل ما نستبعد حالات بالتخمين.
  const DONE_STATUSES = /^\s*(completed|partial\s*completed)\s*$/i;
  const OK_STATUSES = { test: (v) => !DONE_STATUSES.test(String(v || "").trim()) };

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
  // عناصر لوحة السكربت نفسها — لازم نستبعدها من أى بحث عن أزرار الصفحة، وإلا بيضغط
  // زر «ابدأ» بتاعنا على إنه زر من WFM (ظهر فى اللوج كـ BUTTON#sfrsGo).
  function isOurs(el) {
    try { return !!((panel && panel.contains(el)) || (bar && bar.contains(el))); } catch (e) { return false; }
  }
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
      runFlow(v, "cancel");   // اللوحة اليدوى = إلغاء صريح
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
  // رقم أمر الشغل من صف النتائج (7-10 أرقام) — هو بصمة الصف اللى بنتحقق بيها بعدين.
  function rowWorkOrderId(tr) {
    const cells = qAll("td", tr).map(txt);
    for (const c of cells) { const m = c.match(/^\s*(\d{7,10})\s*$/); if (m) return m[1]; }
    return "";
  }
  function readResultRows() {
    const seen = [];
    const rows = [];
    for (const el of qAllDocs("td, div, span")) {
      if (!visible(el) || isOurs(el)) continue;
      const t = txt(el);
      if (!t || !STATUS_RE.test(t)) continue;
      let tr = null;
      try { tr = el.closest("tr"); } catch (e) {}
      if (!tr || seen.indexOf(tr) >= 0) continue;
      // نتأكد إنه صف بيانات فعلاً (فيه كذا خلية) مش عنصر فى مفتاح الألوان
      if (qAll("td", tr).length < 3) continue;
      seen.push(tr);
      // ⚠️ صف بيانات حقيقى لازم يكون فيه رقم أمر شغل. من غير الشرط ده كنا بنلقط قيم
      // قائمة Status المنسدلة (اللى بتقع جوّه نفس منطقة TasksQueue فالـ id مابيفرقش)،
      // فبعد الإلغاء كان بيطلع 11 حالة لجدول فيه صف واحد والحكم يبقى غلط.
      const wo = rowWorkOrderId(tr);
      if (!wo) continue;
      rows.push({ tr, status: t, workOrderId: wo });
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
  const clsOf = (n) => String((n && n.className && n.className.baseVal !== undefined ? n.className.baseVal : (n && n.className)) || "");
  // ⚠️ الإصدار القديم كان بيطلع ٤ مستويات لفوق ويدوّر على كلمة "disabled" كجزء من أى
  // كلاس — وده إنذار كاذب سهل جداً فى ADF (كلاس على حاوية بعيدة يخلّى زر شغّال يبان
  // معطّل، وهو اللى منع ضغط Assign). دلوقتى: الخاصية الحقيقية، أو aria-disabled، أو
  // **توكن كلاس كامل** معروف للتعطيل على العنصر نفسه أو أبوه المباشر بس.
  const DISABLED_CLS = /(^|\s)(p_AFDisabled|af_disabled|disabled|x1w[a-z0-9]*Disabled)(\s|$)/;
  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled === true) return true;
    if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return true;
    if (DISABLED_CLS.test(clsOf(el))) return true;
    const p = el.parentElement;
    if (p && DISABLED_CLS.test(clsOf(p))) return true;
    return false;
  }

  function matchingItems(re) {
    return qAllDocs("[role='menuitem'], a, div, span, li, td").filter((el) => {
      if (!visible(el) || isOurs(el)) return false;
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
      if (!visible(el) || isOurs(el)) return false;
      let r; try { r = el.getBoundingClientRect(); } catch (e) { return false; }
      // إحداثيات سالبة = عنصر برّه الشاشة (أو لوحتنا) — مش زر فى الهيدر
      if (r.top < 0 || r.left < 0 || r.top > 140 || r.left > 160) return false;
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
  const DISPATCH_RE = /assignment\s*and\s*dispatch/i;
  // بيجرّب عنصر واحد ويتأكد إن التنقّل حصل فعلاً. لو العنصر جوّه <a href> بننقل باللينك
  // مباشرةً (أضمن من ضغطة على div شكله بند قائمة بس مش شايل الـ handler).
  // ADF بيحط اللينك الحقيقى فى <a> **جوّه** البند/البلاطة (طبقة شفافة فوقها)، مش فوقه.
  // فبندوّر جوّا الأول ثم فوق. بيرجّع الـ <a> أو null.
  // guardRe = نص البند المطلوب. لازم نتأكد إحنا لسه جوّه **نفس البند** وإحنا بنطلع لفوق:
  // من غير الحارس ده ممكن نوصل لحاوية القائمة كلها وناخد أول <a> فيها (= بند تانى خالص
  // زى Dashboard) ونضغطه ونفتكر إننا نجحنا.
  function innerAnchor(el, guardRe) {
    const pick = (node) => { try { return node.querySelector && node.querySelector("a"); } catch (e) { return null; } };
    let a = pick(el);
    if (a) return a;
    // ندوّر جوّا الحاويات الأعلى شوية (البلاطة = gridcell فيها الـ label + طبقة اللينك)
    let node = el;
    for (let up = 0; up < 5 && node; up++) {
      node = node.parentElement;
      if (!node) break;
      const t = txt(node);
      if (t.length > 40) break;                  // بقينا فى حاوية فيها بنود تانية
      if (guardRe && !guardRe.test(t)) break;     // مابقاش نص البند المطلوب
      a = pick(node);
      if (a) return a;
    }
    try { return el.closest && el.closest("a"); } catch (e) { return null; }
  }

  async function tryDispatchEntry(el, why) {
    const a = innerAnchor(el, DISPATCH_RE);
    const href = a && a.getAttribute("href");
    if (href && !/^\s*(#|javascript:)/i.test(href)) {
      logln("🔗 " + why + " — لينك مباشر: " + href);
      try { location.href = new URL(href, location.href).href; return true; } catch (e) {}
    }
    const target = a || menuTarget(el);
    logln("📂 " + why + " — بضغط " + describeEl(target) + "…");
    fireClick(target);
    // مابنفترضش إن الضغطة نفعت — بنستنى تنقّل فعلى لـ /Dispatcher/
    return !!(await waitFor(() => /\/Dispatcher\//i.test(location.pathname), 6000, 300));
  }

  const DIRECT_KEY = "sf_wfm_direct_tries";   // كام مرة جرّبنا الدخول المباشر لـ Dispatcher
  const DIRECT_TS_KEY = "sf_wfm_direct_ts";   // إمتى — العدّاد ده **مؤقّت** مش دايم
  // العدّاد الغرض منه بس نمنع لفّة لا نهائية بين WorkOrder وDispatcher فى نفس اللحظة.
  // لو عدّى عليه أكتر من دقيقة يبقى من تشغيلة قديمة ومالوش لازمة — نتجاهله ونجرّب
  // الدخول المباشر من جديد. من غير الحد ده كان بيفضل عالق فى التاب فيتخطّى الدخول
  // المباشر ويلفّ على قائمة المربعات (والريفريش كان بيحلّها لأنه بيمسح الجلسة).
  const DIRECT_TTL_MS = 60 * 1000;
  function directTries() {
    try {
      const ts = Number(sessionStorage.getItem(DIRECT_TS_KEY) || 0);
      if (!ts || Date.now() - ts > DIRECT_TTL_MS) return 0;
      return Number(sessionStorage.getItem(DIRECT_KEY)) || 0;
    } catch (e) { return 0; }
  }
  function markDirectTry(n) {
    try { sessionStorage.setItem(DIRECT_KEY, String(n)); sessionStorage.setItem(DIRECT_TS_KEY, String(Date.now())); } catch (e) {}
  }
  // ريفريش الصفحة — بحد أقصى مرتين لكل طلب عشان مانلفّش فى دايرة. صفحة WorkOrder
  // بتعلق أحياناً والريفريش بيحلّها (مجرَّب يدوياً)، فبنعمله إحنا بدل المستخدم.
  const RELOAD_KEY = "sf_wfm_reloads";
  const MAX_RELOADS = 2;
  // ❗أى ريفريش ممنوع بعد ما ننفّذ Cancel/Assign — التحقق بيتعمل بضغطة Search بس.
  // الريفريش بعد التنفيذ خطر: بيعيد تشغيل التدفّق من أول وجديد على مهمة اتنفّذت خلاص.
  let actionDone = false;
  function reloadOnce(why) {
    if (actionDone) { logln("⛔ مافيش ريفريش بعد التنفيذ — التحقق بـ Search بس."); return false; }
    let n = 0; try { n = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch (e) {}
    if (n >= MAX_RELOADS) { logln("⛔ عملت ريفريش " + n + " مرة خلاص — مش هكرّر."); return false; }
    try { sessionStorage.setItem(RELOAD_KEY, String(n + 1)); } catch (e) {}
    logln("🔄 " + why + " — بعمل ريفريش للصفحة (" + (n + 1) + "/" + MAX_RELOADS + ").");
    // ⚠️ location.reload() لوحده بيرجّع الصفحة **من غير الهاش** (ADF بيشيله)، فالتحميل
    // الجديد مايعرفش إن ده طلب جديد ومايصفّرش العدّادات — وده اللى كان بيخلّى الريفريش
    // بتاعنا مايفيدش والريفريش اليدوى بتاعك يفيد. فبنعيد التحميل **بالهاش كامل**.
    const target = entryUrlFor(pendingId());
    setTimeout(() => {
      try {
        if (location.href === target) location.reload();
        else location.replace(target);
      } catch (e) { try { location.reload(); } catch (e2) {} }
    }, 400);
    return true;
  }

  // بننقل الصفحة **ونتأكد** إن النقل حصل فعلاً. لو فضلنا مكاننا: نعيد بـ replace،
  // وبعدين ريفريش — ده اللى كان بيخلّى الشاشة «معلّقة» لحد ما تعمل ريفريش بإيدك.
  async function goTo(url) {
    const base = url.split("#")[0];
    logln("↪️ رايح: " + url);
    try { location.href = url; } catch (e) {}
    await sleep(4000);
    if (location.href.indexOf(base) >= 0) return;
    logln("   … التنقّل ماحصلش — بعيد المحاولة بـ replace.");
    try { location.replace(url); } catch (e) {}
    await sleep(4000);
    if (location.href.indexOf(base) >= 0) return;
    reloadOnce("التنقّل لـ Dispatcher ماحصلش");
  }

  // بنحمل الرقم فى الهاش مع كل نقلة داخلية — كده مايضيعش أبداً حتى لو الصفحة اتفتحت
  // فى تاب جديد أو sessionStorage اتمسح.
  // الرقم المحفوظ حالياً (من غير اعتماد على متغيّر التدفّق) — عشان نبنى بيه اللينكات
  function pendingId() {
    try { return sessionStorage.getItem(PENDING_KEY) || ""; } catch (e) { return ""; }
  }
  // لينك صفحة الدخول ومعاه الطلب كامل فى الهاش
  function entryUrlFor(serviceId) {
    return serviceId ? WFM_HOME_URL + hashFor(serviceId) : WFM_HOME_URL;
  }
  function hashFor(serviceId) {
    let mode = "", worker = "";
    try { mode = sessionStorage.getItem(MODE_KEY) || ""; worker = sessionStorage.getItem(WORKER_KEY) || ""; } catch (e) {}
    return "#sf_cancel=" + encodeURIComponent(serviceId) +
      (mode ? "&sf_mode=" + encodeURIComponent(mode) : "") +
      (worker ? "&sf_worker=" + encodeURIComponent(worker) : "");
  }
  function dispatcherUrlFor(serviceId) {
    // بنحمل الوضع وكود العامل كمان — مش الرقم بس. كده لو sessionStorage ضاع (تاب
    // جديد/جلسة اتمسحت) الطلب يفضل كامل فى اللينك ومايتحوّلش لوضع cancel بالغلط.
    return serviceId ? DISPATCHER_URL + hashFor(serviceId) : DISPATCHER_URL;
  }

  async function gotoDispatcherApp(serviceId) {
    if (/\/Dispatcher\//i.test(location.pathname)) return true;

    // (1) **الطريق الأساسى**: الدخول المباشر بلينك Dispatcher. إحنا دلوقتى على WFM
    //     العادى يعنى الجلسة شغّالة، والدخول المباشر بالجلسة بيفتح عادى. (الصفحة البيضا
    //     القديمة كانت faces/UIShell من غير جلسة أصلاً.) ده أسرع وأضمن بكتير من محاولة
    //     ضغط بنود قائمة ADF اللى الـ handler بتاعها مش على العنصر اللى فيه النص.
    const tries = directTries();
    if (tries < 1) {
      markDirectTry(tries + 1);
      logln("↪️ بادخل Dispatcher/faces/Home مباشرةً (الجلسة شغّالة).");
      await goTo(dispatcherUrlFor(serviceId));
      return "navigating";
    }

    // (2) الدخول المباشر مانفعش. **الريفريش بيحلّها** (مجرَّب: الصفحة بتعلق على
    //     WorkOrder/faces/Home وأول ما تعمل ريفريش بتكمّل) — فنعمله إحنا قبل ما
    //     نضيّع الوقت فى قائمة المربعات اللى بنودها الـ handler مش عليها.
    if (reloadOnce("الدخول المباشر ماحصلش")) return "navigating";
    logln("🔳 الريفريش مانفعش كمان — بجرّب قائمة المربعات.");
    for (const el of matchingItems(DISPATCH_RE)) {
      if (await tryDispatchEntry(el, "بند ظاهر")) return "navigating";
    }
    const burger = findMenuToggle();
    if (burger) {
      logln("☰ بفتح القائمة…");
      fireClick(burger); await sleep(1200);
      for (const el of matchingItems(DISPATCH_RE)) {
        if (await tryDispatchEntry(el, "بند بعد فتح القائمة")) return "navigating";
      }
    }
    // بحد زمنى — من غيره الشاشة بتفضل «معلّقة» دقايق وإحنا بنلفّ على أزرار الركن.
    const deadline = Date.now() + 40000;
    for (const c of topLeftCandidates()) {
      if (Date.now() > deadline) { logln("⏱ خلصت مهلة البحث عن زر القائمة."); break; }
      logln("🔳 بجرّب زر أعلى اليسار: " + describeEl(c));
      fireClick(c);
      await sleep(1000);
      for (const el of matchingItems(DISPATCH_RE)) {
        if (await tryDispatchEntry(el, "بند من قائمة المربعات")) return "navigating";
      }
    }
    logln("↪️ مالقيتش الزر — بادخل Dispatcher مباشرةً تانى.");
    markDirectTry(0);
    await goTo(dispatcherUrlFor(serviceId));
    return "navigating";
  }

  // ضغط «بلاطة» على شاشة Dispatcher/faces/Home. البلاطة = نص العنوان + طبقة شفافة
  // فوقها فيها <a> هو اللينك الحقيقى — فبنضغط الـ <a> مش النص.
  async function clickTile(re, label) {
    const hits = matchingItems(re).filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 20 && b.height > 5;
    });
    if (!hits.length) { logln("… مش لاقى بلاطة «" + label + "» على الشاشة."); return false; }
    for (const hit of hits.slice(0, 4)) {
      const a = innerAnchor(hit, re);
      const href = a && a.getAttribute("href");
      if (href && !/^\s*(#|javascript:)/i.test(href)) {
        logln("🔗 بلاطة «" + label + "» — لينك مباشر: " + href);
        try { location.href = new URL(href, location.href).href; return true; } catch (e) {}
      }
      const target = a || menuTarget(hit);
      logln("🧱 بضغط بلاطة «" + label + "»: " + describeEl(target) + "…");
      fireClick(target);
      await waitIdle(20000);
      if (findServiceIdInput()) return true;
      if (await waitFor(() => findServiceIdInput(), 6000)) return true;
    }
    return false;
  }

  // شاشة البحث اللى بنشتغل عليها هى «Tasks Queue». على Dispatcher/faces/Home بتبقى
  // بلاطة ظاهرة قدامنا — بنضغطها على طول. (الإصدار القديم كان بيدوّر على بند «Home»
  // فى القائمة الأول ويفضل يلفّ عليه من غير ما يوصل، والبلاطة قدامه.)
  async function gotoTasksQueue(serviceId) {
    if (findServiceIdInput()) return true;           // إحنا عليها أصلاً
    for (let attempt = 1; attempt <= 3; attempt++) {
      // matchingItems أصلاً بيستبعد الحاويات الكبيرة (نص أطول من 40 حرف)، فالمطابقة
      // المرنة هنا آمنة وبتلقط عنوان البلاطة حتى لو حواليه مسافات/أيقونة.
      if (await clickTile(/tasks\s*queue/i, "Tasks Queue")) return true;
      if (findServiceIdInput()) return true;
      // مش على شاشة البلاطات؟ ندخل Dispatcher/faces/Home ونعيد بعد التحميل
      if (!/\/Dispatcher\/faces\/Home/i.test(location.href)) {
        logln("↪️ مش على شاشة بلاطات Dispatcher — بادخل Dispatcher/faces/Home.");
        location.href = dispatcherUrlFor(serviceId);   // الرقم ماشى فى الهاش
        return false;
      }
      logln("… محاولة " + attempt + " لفتح Tasks Queue لسه ماوصلتش.");
      await sleep(1500);
    }
    return !!findServiceIdInput();
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

  // فتح قائمة السطر. ADF بيرسم زر القائمة كمجموعة عناصر (أيقونة + سهم ▾) والـ handler
  // مش دايماً على العنصر صاحب الـ id — فبنجرّب كل عنصر قابل للضغط جوّه/حوالين الأيقونة،
  // **وبعد كل ضغطة بنتأكد** هل ظهرت «Cancel» جديدة ولا لأ (مش بنفترض إن الضغطة نفعت).
  async function openRowMenu(tr, itemRe) {
    const holders = findRowMenuButtons(tr) || [];
    const targets = [];
    const push = (el) => { if (el && visible(el) && targets.indexOf(el) < 0) targets.push(el); };
    for (const h of holders) {
      push(h);
      qAll("a, img, span, div, td, button", h).forEach(push);
      // السهم ▾ ساعات بيبقى **شقيق** الأيقونة مش ابنها
      let p = null; try { p = h.parentElement; } catch (e) {}
      if (p) { push(p); qAll("a, img, span, div", p).forEach(push); }
    }
    if (!targets.length) { logln("   … مش لاقى أيقونة القائمة."); return null; }
    // الزر الحقيقى فى ADF menuBar هو <div role="menuitem" tabindex="0"> — نجرّبه الأول.
    targets.sort((a, b) => menuScore(b) - menuScore(a));
    // ٤ مرشّحين بس — الترتيب بقى بالأولوية، وكل مرشّح بياخد ٧ محاولات تفعيل
    for (let i = 0; i < targets.length && i < 4; i++) {
      const el = targets[i];
      logln("   🖱 بجرّب " + (i + 1) + "/" + Math.min(targets.length, 4) + ": " + describeEl(el));
      const item = await activateMenu(el, itemRe);
      if (item) return item;
      try { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
      await sleep(300);
    }
    return null;
  }

  // ترتيب الأولوية: العنصر اللى شكله بند قائمة فعلاً (role=menuitem / tabindex / x17h)
  function menuScore(el) {
    let s = 0;
    try {
      if (el.getAttribute("role") === "menuitem") s += 5;
      if (el.getAttribute("data-afr-fcs") === "true") s += 3;
      if (el.hasAttribute("tabindex")) s += 2;
      if (el.getAttribute("aria-haspopup") === "true") s += 4;
      const cls = String(el.className || "");
      if (/x17h/.test(cls)) s += 3;
      if (el.tagName === "A" && el.getAttribute("style") && /display:\s*none/i.test(el.getAttribute("style"))) s -= 10;
    } catch (e) {}
    return s;
  }

  function hoverEl(el) {
    for (const t of ["pointerover", "mouseover", "pointerenter", "mouseenter", "pointermove", "mousemove"]) {
      try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    }
  }
  function keyOn(el, key, code) {
    for (const t of ["keydown", "keypress", "keyup"]) {
      try {
        el.dispatchEvent(new KeyboardEvent(t, {
          key, code: key === " " ? "Space" : key, keyCode: code, which: code,
          bubbles: true, cancelable: true, view: window,
        }));
      } catch (e) {}
    }
  }

  // نفس تسلسل الضغط اللى بيفتح بيه سكربت تصدير WFM قوايم ADF على **نفس الموقع** ده
  // (te-fcc-wfm-oss-subinfo → realClick): mousedown ثم mouseup ثم click، **من غير** أى
  // pointer events. الترتيب ده مجرَّب وشغّال على قائمة operations وزر Export.
  function fireMouse(el, type) {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  }
  function realClick(el) {
    try { el.scrollIntoView({ block: "center" }); } catch (e) {}
    for (const t of ["mousedown", "mouseup", "click"]) fireMouse(el, t);
  }

  // بنود ADF menuBar (class=af_menuBar_items, role=menuitem, tabindex=0, data-afr-fcs)
  // مش بتستجيب لنفس الضغطة دايماً — فبنصعّد خطوة خطوة، **وبعد كل خطوة نتأكد** هل
  // «Cancel» ظهرت فعلاً ولا لأ. الترتيب: الطرق المجرَّبة من سكربت التصدير الأول
  // (click أصلى ← realClick ← dblclick)، وبعدها التفعيل بالكيبورد (بند role=menuitem
  // بـ tabindex بيتفتح بـ Enter/سهم لأسفل).
  async function activateMenu(el, itemRe) {
    const CANCEL_RE = itemRe || /^\s*cancel\s*$/i;
    const steps = [
      // من تسلسل كلاسات ADF فى التشخيص: hover (p_AFHoverTarget) ← mousedown
      // (p_AFDepressed) = القائمة بتفتح. يعنى الفتح على **mousedown بعد hover**، مش
      // على click كامل — والـ click الكامل ممكن يقفلها تانى. فدى أول محاولة.
      ["hover ثم mousedown", () => { hoverEl(el); try { el.focus(); } catch (e) {} fireMouse(el, "mousedown"); }],
      ["hover + ضغطة كاملة", () => { hoverEl(el); fireClick(el); }],
      ["click أصلى", () => { try { el.click(); } catch (e) {} }],
      ["realClick", () => realClick(el)],
      ["dblclick", () => fireMouse(el, "dblclick")],
      ["Enter", () => { try { el.focus(); } catch (e) {} keyOn(el, "Enter", 13); }],
      ["سهم لأسفل", () => { try { el.focus(); } catch (e) {} keyOn(el, "ArrowDown", 40); }],
      ["مسافة", () => { try { el.focus(); } catch (e) {} keyOn(el, " ", 32); }],
    ];
    for (const [name, act] of steps) {
      const before = matchingItems(CANCEL_RE);   // «Cancel» الموجودة قبل المحاولة
      act();
      await sleep(1700);                          // نفس مهلة سكربت التصدير المجرَّبة
      await waitIdle(5000);
      const hit = await waitFor(() => findNewMenuItem(CANCEL_RE, before), 2000);
      if (hit) { logln("      ✔ القائمة اتفتحت بـ «" + name + "»."); return hit; }
      // الخطوة فشلت — نقفل أى أثر قبل الخطوة اللى بعدها عشان مانكدّسش قوايم نصّ مفتوحة
      try { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
      await sleep(300);
    }
    return null;
  }

  // تفعيل **بند** فى قائمة مفتوحة، بنفس أسلوب التصعيد + التحقق. مهم جداً: لما القائمة
  // بتتفتح بالكيبورد (سهم لأسفل/Enter)، ضغطة الماوس على البند ساعات بتقفل القائمة من
  // غير ما تنفّذ — فلازم نجرّب الكيبورد كمان، **ونتأكد** إن النتيجة المتوقّعة حصلت.
  async function activateItem(el, verify, label) {
    const steps = [
      ["click أصلى", () => { try { el.click(); } catch (e) {} }],
      ["realClick", () => realClick(el)],
      ["hover + ضغطة", () => { hoverEl(el); fireClick(el); }],
      ["Enter", () => { try { el.focus(); } catch (e) {} keyOn(el, "Enter", 13); }],
      ["مسافة", () => { try { el.focus(); } catch (e) {} keyOn(el, " ", 32); }],
    ];
    for (const [name, act] of steps) {
      act();
      await waitIdle(8000);
      const ok = await waitFor(verify, 3000);
      if (ok) { logln("      ✔ «" + label + "» اتنفّذ بـ «" + name + "»."); return ok; }
    }
    return null;
  }

  // لو كل المحاولات فشلت: نطبع شكل أول خليتين فى الصف عشان نشوف الماركب الحقيقى
  // بدل التخمين (بيتنسخ من اللوج).
  function dumpRowMarkup(tr) {
    try {
      const cells = qAll("td, th", tr).slice(0, 2);
      cells.forEach((c, i) => {
        const html = (c.innerHTML || "").replace(/\s+/g, " ").slice(0, 700);
        logln("   🧬 خلية " + (i + 1) + ": " + html);
      });
    } catch (e) { logln("   🧬 تعذّر قراءة ماركب الصف: " + (e && e.message)); }
  }

  /* ================== الإسناد لفنى آخر (Re-assign) ================== */
  // نافذة WFM بتعرض التاريخ بصيغة DD-MM-YYYY (مثال: 05-08-2026 ليوم 5 أغسطس 2026).
  function todayDMY() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return p(d.getDate()) + "-" + p(d.getMonth() + 1) + "-" + d.getFullYear();
  }
  // هل القيمة دى تاريخ النهاردة؟ الصيغة **DD-MM-YYYY** مؤكّدة من تلميح الحقل نفسه
  // («Example: 29-11-2014»)، فبنقارن بالترتيب ده بالظبط. قبل كده كنت بقبل DD-MM أو
  // MM-DD (احتياطاً)، وده كان بيقبل تاريخ غلط: يوم 5 أغسطس، القيمة 08-05-2026
  // (= 8 مايو) كانت بتعدّى كإنها النهاردة فمانصلّحهاش. الفاصل حر (- أو /).
  function isToday(v) {
    const nums = String(v || "").match(/\d+/g);
    if (!nums || nums.length < 3) return false;
    const d = new Date();
    const [dd, mm, yy] = nums.map(Number);
    return dd === d.getDate() && mm === d.getMonth() + 1 && yy === d.getFullYear();
  }
  // نافذة بعنوان معيّن (نص العنوان بيبقى فى أول النافذة)
  function dialogByTitle(re) {
    const cands = qAllDocs("[role='dialog'], [id$='::_af_Z_window'], .AFZOrderLayer");
    for (const el of cands) {
      if (!visible(el) || isOurs(el)) continue;
      if (re.test(txt(el))) return el;
    }
    return null;
  }
  const BTN_SEL = "button, a, input[type='submit'], input[type='button'], span[role='button'], div[role='button'], td, div, span";
  const btnLabel = (el) => (txt(el) || String(el.value || "")).trim();
  // كل الأزرار المطابقة (حتى المعطّلة) — عشان نفرّق بين «مش موجود» و«موجود بس معطّل»
  const btnsIn = (root, re) =>
    qAll(BTN_SEL, root).filter((el) => visible(el) && !isOurs(el) && btnLabel(el).length <= 30 && re.test(btnLabel(el)));
  const btnIn = (root, re) => btnsIn(root, re).find((el) => !isDisabled(el)) || null;

  // بيستنى زر يظهر ويبقى مفعّل. بيدوّر جوّه النافذة الأول، وبعدين فى أى نافذة، وبعدين
  // فى الصفحة كلها — لأن ADF ساعات بيرسم شريط أزرار النافذة **برّه** حاوية المحتوى،
  // فالبحث جوّه الحاوية وحدها بيرجع فاضى. ولو لقيناه معطّل بنقول كده بالظبط.
  async function waitForButton(root, re, label, ms) {
    const deadline = Date.now() + (ms || 15000);
    let sawDisabled = false;
    while (Date.now() < deadline) {
      await waitIdle(6000);
      for (const scope of [root, dialogByTitle(/.+/), document.body]) {
        if (!scope) continue;
        const all = btnsIn(scope, re);
        if (!all.length) continue;
        const live = all.find((el) => !isDisabled(el));
        if (live) return live;
        sawDisabled = true;
      }
      await sleep(700);
    }
    if (sawDisabled) {
      // ملاحق: نطبع سبب اعتبارنا إياه معطّل، وبنضغطه برضه كآخر محاولة — ضغط زر معطّل
      // فعلاً مابيعملش حاجة، فمفيش ضرر، والمكسب إننا مانتعطّلش بسبب إنذار كاذب.
      const cand = btnsIn(root, re)[0] || btnsIn(document.body, re)[0];
      if (cand) {
        logln("   ⛔ «" + label + "» ظاهر معطّل: " + describeEl(cand) + " | class=" + clsOf(cand) +
              " | aria-disabled=" + (cand.getAttribute && cand.getAttribute("aria-disabled")));
        logln("   ↪️ بضغطه برضه كآخر محاولة.");
        return cand;
      }
      logln("   ⛔ زر «" + label + "» موجود بس **معطّل**.");
    } else {
      // تشخيص: إيه الأزرار الموجودة فعلاً فى النافذة؟
      const seen = qAll(BTN_SEL, root).filter((el) => visible(el) && !isOurs(el))
        .map(btnLabel).filter((t) => t && t.length <= 20);
      logln("   🔎 الأزرار الظاهرة: " + ([...new Set(seen)].join(" | ") || "(مفيش)"));
    }
    return null;
  }

  // بيقرا حقل جنب عنوان معيّن جوّه نافذة، ويرجّع {input, value, from}.
  // ⚠️ مافيش fallback بـ «أول input فى النافذة» — ده كان بيرجّع حقل **التاريخ** لما
  // مايلاقيش عنوان Worker، فنقارن 05-08-2026 بكود العامل ونفتكر إنه غلط ونفتح نافذة
  // البحث بلا أى داعى. لو مالقيناش الحقل بنرجّع from="none" والمُنادِى يتصرّف بوضوح.
  // القيمة ممكن تكون فى <input> (والـ textContent مابيشوفش قيم الـ inputs أصلاً)،
  // أو نص جنب العنوان، أو ملزوقة معاه فى نفس العنصر («Worker 347817»).
  function fieldNear(root, labelRe, stripRe) {
    const labs = qAll("label, span, div, td, th", root)
      .filter((el) => visible(el) && !isOurs(el) && labelRe.test(txt(el)) && txt(el).length <= 40);
    for (const lab of labs) {
      let box = lab;
      for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
        const inp = qAll("input[type='text'], input:not([type]), textarea", box).filter(visible)[0];
        if (inp) return { input: inp, value: String(inp.value || "").trim(), from: "input" };
      }
      let sib = lab.nextElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.nextElementSibling) {
        const t = txt(sib);
        if (t) return { input: null, value: t, from: "sibling" };
      }
      const inline = stripRe ? txt(lab).replace(stripRe, "").trim() : "";
      if (inline) return { input: null, value: inline, from: "inline" };
    }
    return { input: null, value: "", from: "none" };
  }

  // نافذة «Assign Task to Technician/Team»: نكتب كود العامل ← Search ← نختار السطر ← OK
  async function pickWorkerByCode(code) {
    const dlg = await waitFor(() => dialogByTitle(/assign\s*task\s*to\s*technician/i), 15000);
    if (!dlg) { logln("   ❌ نافذة اختيار العامل مافتحتش."); return false; }
    const wf2 = fieldNear(dlg, /^\s*\*?\s*worker\s*:?\s*$/i);
    const wIn = wf2.input;
    if (!wIn) { logln("   ❌ مش لاقى خانة Worker فى نافذة الاختيار (" + wf2.from + ")."); return false; }
    setValue(wIn, code);
    logln("   ⌨️ كتبت كود العامل " + code + " فى خانة Worker.");
    const searchBtn = await waitForButton(dlg, /^\s*search\s*$/i, "Search", 10000);
    if (!searchBtn) { logln("   ❌ مش لاقى زر Search."); return false; }
    fireClick(searchBtn);
    await waitIdle(20000);
    // لازم يظهر سطر نتيجة فعلاً — «No data to display» معناها الكود غلط
    const row = await waitFor(() => {
      const t = txt(dlg);
      if (/no\s*data\s*to\s*display/i.test(t)) return null;
      return qAll("tr", dlg).find((tr) => visible(tr) && txt(tr).indexOf(code) >= 0) || null;
    }, 12000);
    if (!row) { logln("   ❌ البحث مارجّعش عامل بالكود " + code + "."); return false; }
    fireClick(row);
    await sleep(700);
    const okBtn = await waitForButton(dlg, /^\s*ok\s*$/i, "OK", 10000);
    if (!okBtn) { logln("   ❌ مش لاقى زر OK فى نافذة الاختيار."); return false; }
    fireClick(okBtn);
    await waitIdle(20000);
    logln("   ✅ اتاختار العامل " + code + ".");
    return true;
  }

  // نافذة «Cancel Dispatch then Re-assign Task To»: تاريخ النهاردة + كود العامل ثم Assign
  // نافذة Re-assign **حقيقية**: عنوانها مطابق + فيها حقل تاريخ + فيها زر Assign.
  // مجرّد مطابقة العنوان مش كفاية: ADF بيسيب بقايا نوافذ قديمة فى الصفحة، وده اللى
  // خلّى السكربت يقول «اتفتحت النافذة» ويقرا منها قيم والنافذة أصلاً مافتحتش.
  function reassignDialog() {
    const cands = qAllDocs("[role='dialog'], [id$='::_af_Z_window'], .AFZOrderLayer");
    for (const el of cands) {
      if (!visible(el) || isOurs(el)) continue;
      if (!/re-?assign\s*task\s*to/i.test(txt(el))) continue;
      if (!btnsIn(el, /^\s*assign\s*$/i).length) continue;
      if (!qAll("input[type='text'], input:not([type])", el).filter(visible).length) continue;
      return el;
    }
    return null;
  }

  // prevDlg = النافذة اللى كانت موجودة **قبل** ضغط Re-assign (لو فيه بقايا) — بنستنى
  // نافذة **مختلفة** عنها عشان مانتعاملش مع الأثر القديم على إنه النافذة الجديدة.
  async function doReassign(code, openedDlg) {
    const dlg = openedDlg || await waitFor(() => reassignDialog(), 20000);
    if (!dlg) {
      banner("❌ نافذة Re-assign مافتحتش.", "#c62828");
      logln("   🔎 مفيش نافذة فيها حقل تاريخ وزر Assign.");
      return false;
    }
    logln("🪟 نافذة Re-assign جاهزة (فيها حقل تاريخ وزر Assign).");

    // (أ) التاريخ لازم يكون النهاردة
    const dateF = fieldNear(dlg, /^\s*\*?\s*on\s*:?\s*$/i, /^\s*\*?\s*on\s*:?\s*/i);
    if (dateF.input) {
      const cur = dateF.value;
      if (isToday(cur)) { logln("   📅 التاريخ صح (" + cur + ")."); }
      else { setValue(dateF.input, todayDMY()); logln("   📅 التاريخ كان " + (cur || "فاضى") + " → بقى " + todayDMY() + "."); }
    } else { logln("   ⚠️ مش لاقى خانة التاريخ (" + dateF.from + ") — بكمّل."); }

    // (ب) كود العامل لازم يكون المطلوب — الحقل ساعات نص مش input، فبنقرا نص النافذة كمان
    const WORKER_LAB = /^\s*\*?\s*worker\s*:?\s*$/i;
    let wf = fieldNear(dlg, WORKER_LAB, /^\s*\*?\s*worker\s*:?\s*/i);
    // العنوان ساعات بيبقى ملزوق بالقيمة فى نفس الخلية: «Worker 347817»
    if (wf.from === "none") wf = fieldNear(dlg, /^\s*\*?\s*worker\b/i, /^\s*\*?\s*worker\s*:?\s*/i);
    const shown = wf.value;
    logln("   👷 كود العامل الظاهر: «" + (shown || "—") + "» (من " + wf.from + ") | المطلوب: " + code);
    // بنقارن بالأرقام بس عشان أى مسافات/رموز حوالين الكود ماتخربش المقارنة
    const digits = (v) => String(v || "").replace(/\D/g, "");
    const already = !!shown && digits(shown) === digits(code);
    if (already) {
      logln("   ✔ كود العامل مظبوط أصلاً — مش محتاجين نافذة البحث.");
    } else {
      logln("   ↪️ الكود مش المطلوب — بفتح نافذة البحث.");
      // علامة المكبّر جنب خانة Worker
      const mag = qAll("a, img, button, div[role='button'], span[role='button']", dlg)
        .filter((el) => visible(el) && !isDisabled(el))
        .filter((el) => {
          const meta = [el.id, el.title, el.getAttribute && el.getAttribute("aria-label"), el.alt, el.src,
            String(el.className || "")].map((x) => String(x || "")).join(" ");
          return /search|lov|magnif|find|بحث/i.test(meta);
        });
      let opened = false;
      for (const m of mag.slice(0, 4)) {
        logln("   🔍 بجرّب زر البحث: " + describeEl(m));
        fireClick(m);
        await waitIdle(10000);
        if (dialogByTitle(/assign\s*task\s*to\s*technician/i)) { opened = true; break; }
      }
      if (!opened) { banner("❌ مش لاقى زر البحث (المكبّر) جنب Worker.", "#c62828"); return false; }
      if (!(await pickWorkerByCode(code))) { banner("❌ تعذّر اختيار العامل " + code + ".", "#c62828"); return false; }
    }

    // (ج) Assign — بنستنّاه يظهر ويبقى مفعّل (ADF بيعطّل الأزرار وهو مشغول)
    const dlg2 = reassignDialog() || dlg;
    const assignBtn = await waitForButton(dlg2, /^\s*assign\s*$/i, "Assign", 20000);
    if (!assignBtn) { banner("❌ مش لاقى زر Assign مفعّل.", "#c62828"); return false; }
    logln("   🖱 زر Assign: " + describeEl(assignBtn));
    fireClick(assignBtn);
    logln("   ✅ اتضغط Assign.");
    await waitIdle(25000);
    return true;
  }

  /* ================== التدفّق الرئيسى ================== */
  // الرقم المطلوب إلغاؤه بيعيش عبر أكتر من تحميل صفحة (WorkOrder → Dispatcher → Tasks
  // Queue)، فبنخزّنه فى sessionStorage. القاعدة: **مانمسحوش إلا عند نهاية مؤكّدة** —
  // المسح على أى فشل مؤقّت كان بيضيّعه وإحنا لسه بننقل الصفحة (الخانة كانت بترجع فاضية).
  const PENDING_KEY = "sf_wfm_cancel_pending";
  const PENDING_TS_KEY = "sf_wfm_cancel_pending_ts";
  const PENDING_HOPS_KEY = "sf_wfm_cancel_hops";
  const MODE_KEY = "sf_wfm_cancel_mode";       // cancel | reassign
  const WORKER_KEY = "sf_wfm_cancel_worker";   // كود العامل للإسناد
  // كام مللى نسيب رسالة WFM ظاهرة قبل ما نضغط OK — عشان تلحق تتقرا. صفّرها لو
  // عايز الإغلاق فورى، أو كبّرها لو عايز وقت أطول.
  const DIALOG_SHOW_MS = 4000;
  const PENDING_MAX_AGE = 15 * 60 * 1000;   // رقم قديم مايتنفّذش لوحده بعد ربع ساعة
  // حد أقصى لعدد تحميلات الصفحة على نفس الطلب — مجرّد حارس ضد اللف فى دايرة. الحماية
  // الحقيقية هى صلاحية الربع ساعة. كان 8 وده قليل جداً: التنقّل الطبيعى (WorkOrder →
  // Dispatcher → UIShell) + إعادة رسم ADF بياكلوه، فكان الرقم بيتمسح فى نص الشغل.
  const PENDING_MAX_HOPS = 25;
  function setPending(id) {
    try { sessionStorage.setItem(PENDING_KEY, String(id)); sessionStorage.setItem(PENDING_TS_KEY, String(Date.now())); } catch (e) {}
  }
  function clearPending() {
    try { [PENDING_KEY, PENDING_TS_KEY, PENDING_HOPS_KEY, MODE_KEY, WORKER_KEY, DIRECT_KEY, DIRECT_TS_KEY, RELOAD_KEY].forEach((k) => sessionStorage.removeItem(k)); } catch (e) {}
  }
  function getPending() {
    try {
      const v = sessionStorage.getItem(PENDING_KEY) || "";
      if (!v) return "";
      const ts = Number(sessionStorage.getItem(PENDING_TS_KEY) || 0);
      if (ts && Date.now() - ts > PENDING_MAX_AGE) { clearPending(); return ""; }
      return v;
    } catch (e) { return ""; }
  }
  let running = false;
  // بيتحطّ true لما نكون بننقل لصفحة تانية — ساعتها بنسيب الرقم محفوظ عشان السكربت
  // يكمّل عليه بعد التحميل بدل ما يضيع.
  let navigating = false;
  async function runFlow(serviceId, modeOverride) {
    // الوضع المطلوب: إلغاء الاسناد (Cancel) أو إسناد لفنى آخر (Re-assign) — بيتحدّد من
    // موقعنا قبل ما نفتح WFM، فالسكربت بيضغط البند المطلوب مباشرةً من غير ما يعمل الاتنين.
    let MODE = "", WORKER = "";
    try { MODE = sessionStorage.getItem(MODE_KEY) || ""; WORKER = sessionStorage.getItem(WORKER_KEY) || ""; } catch (e) {}
    if (!MODE) MODE = modeOverride || "";
    // ⚠️ مافيش افتراض إن الوضع «إلغاء». الإلغاء عملية مدمّرة، ولو الوضع ضاع لأى سبب
    // (sessionStorage اتمسح، تاب جديد، الهاش اتغيّر) كان الطلب هيتحوّل من «إسناد لفنى»
    // لـ «إلغاء» فى صمت — يعنى يلغى مهمة المفروض تتسند. فبنوقف ونقول بدل ما نخمّن.
    if (!MODE) {
      banner("❌ الوضع (إلغاء ولا إسناد) مش محدّد — مش هنفّذ حاجة. ابدأ من Service-Flow تانى.", "#c62828");
      logln("⛔ مفيش sf_mode محفوظ ولا فى الهاش — وقفت بدل ما أفترض «إلغاء».");
      clearPending();
      return;
    }
    if (MODE === "reassign" && !WORKER) {
      banner("❌ وضع الإسناد من غير كود عامل — مش هنفّذ.", "#c62828");
      clearPending();
      return;
    }
    const WANTED_RE = MODE === "reassign" ? /^\s*re-?\s*assign\s*$/i : /^\s*cancel\s*$/i;
    const WANTED_LABEL = MODE === "reassign" ? "Re-assign" : "Cancel";
    if (running) { banner("⏳ فيه عملية شغّالة بالفعل…", "#ef6c00"); return; }
    running = true;
    actionDone = false;
    try {
      // الوضع بيتكتب صراحةً فى أول سطر — عشان تعرف من نظرة واحدة إن التشغيلة دى
      // إلغاء ولا إسناد، من غير ما تستنتج من النتيجة.
      const modeLabel = MODE === "reassign" ? ("إسناد لفنى (كود " + WORKER + ")") : "إلغاء إسناد";
      banner("🔎 " + serviceId + " — " + modeLabel + "…");
      logln("▶️ بدء المعالجة للرقم " + serviceId + " — الوضع: " + modeLabel);

      // (1) لو شاشة لوجين → ادخل
      if (onLoginPage()) {
        if (!(await doLogin())) { banner("⛔ تعذّر تسجيل الدخول.", "#c62828"); clearPending(); return; }
        logln("✅ تم تسجيل الدخول.");
      }

      // (2) لو إحنا على WFM العادى → ندخل تطبيق Dispatcher (باللينك مباشرةً، والرقم
      //     ماشى معانا فى الهاش)، والسكربت بيكمّل بعد ما الصفحة الجديدة تحمّل.
      let sidInput = findServiceIdInput();
      if (!sidInput && !/\/Dispatcher\//i.test(location.pathname)) {
        banner("↪️ بفتح تطبيق Dispatcher…");
        const nav = await gotoDispatcherApp(serviceId);
        if (nav === "navigating") { navigating = true; return; }   // الرقم ماشى فى اللينك
        if (!nav) { navigating = true; location.href = dispatcherUrlFor(serviceId); return; }
      }
      // وصلنا Dispatcher → صفّر عدّاد المحاولات عشان الجاى يستخدم اللينك المباشر برضه
      try { sessionStorage.removeItem(DIRECT_KEY); sessionStorage.removeItem(DIRECT_TS_KEY); } catch (e) {}

      // (3) شاشة «Tasks Queue» هى اللى فيها خانة Service Id — لو مش عليها نفتحها من القائمة
      sidInput = findServiceIdInput();
      if (!sidInput) {
        banner("📂 بفتح Tasks Queue…");
        if (!(await gotoTasksQueue(serviceId))) {
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
        banner("• كل السطور حالتها Completed (الموجود: " + rows.map((r) => r.status).join(" ، ") + ").", "#ef6c00");
        clearPending();   // نهاية مؤكّدة
        return;
      }
      logln("✅ " + candidates.length + " سطر مؤهّل.");

      // (6) نجرّب سطر سطر: نفتح قائمته وندوّر على البند المطلوب — لو معطّل ننتقل للى بعده
      let opened = false, reassignDlg = null;
      for (let i = 0; i < candidates.length; i++) {
        const row = candidates[i];
        logln("↪️ سطر " + (i + 1) + " (" + row.status + (row.workOrderId ? " / WO " + row.workOrderId : "") + ")");
        const item = await openRowMenu(row.tr, WANTED_RE);
        if (!item) {
          logln("   … القائمة مافتحتش أو مفيش «" + WANTED_LABEL + "».");
          if (lastRowIcons.length) logln("   🔎 أيقونات الصف: " + lastRowIcons.join(" | "));
          dumpRowMarkup(row.tr);
          continue;
        }
        if (isDisabled(item)) {
          logln("   ⚠️ «" + WANTED_LABEL + "» معطّلة فى السطر ده — بجرّب اللى بعده.");
          try { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
          await sleep(600);
          continue;
        }
        if (MODE === "reassign") {
          // نسجّل أى بقايا نافذة قديمة عشان نفرّقها عن الجديدة، وبنتأكد إن الضغط فتح
          // نافذة فعلاً — مش مجرّد إننا بعتنا ضغطة.
          const prev = reassignDialog();
          if (prev) logln("   ℹ️ فيه بقايا نافذة Re-assign قديمة — هستنى نافذة جديدة غيرها.");
          reassignDlg = await activateItem(item,
            () => { const d = reassignDialog(); return (d && d !== prev) ? d : null; }, "Re-assign");
          if (!reassignDlg) {
            logln("   … الضغط على Re-assign مافتحش النافذة — بجرّب سطر تانى.");
            try { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
            await sleep(600);
            continue;
          }
        } else {
          fireClick(item);
          await waitIdle(15000);
        }
        logln("   ✅ اتضغط «" + WANTED_LABEL + "».");
        actionDone = true;   // من هنا ورايح: مافيش ريفريش، التحقق بـ Search بس
        opened = true;
        break;
      }
      if (!opened) { banner("⚠️ «" + WANTED_LABEL + "» مش متاحة فى أى سطر مؤهّل.", "#ef6c00"); clearPending(); return; }

      // (6ب) وضع الإسناد لفنى آخر: نافذة «Cancel Dispatch then Re-assign Task To»
      if (MODE === "reassign") {
        const ok = await doReassign(WORKER, reassignDlg);
        if (!ok) { clearPending(); return; }   // doReassign بيعرض سبب الفشل بنفسه
      }

      // (7) بعد Cancel ممكن تظهر نافذة تأكيد وممكن تظهر نافذة رسالة من WFM — بنضغط
      //     زر الموافقة (OK/Yes/موافق) وخلاص، من غير ما نقرا نص الرسالة. وممكن تظهر
      //     نافذتين ورا بعض (تأكيد ثم رسالة) فبنلفّ مرتين.
      let lastDlg = null, lastDlgText = "";
      for (let d = 1; d <= 2; d++) {
        const dlg = await waitFor(() => adfDialogRoot(), d === 1 ? 8000 : 3000);
        if (!dlg) { if (d === 1) logln("ℹ️ مفيش نافذة — الإلغاء اتنفّذ مباشرةً."); break; }
        // نفس النافذة/نفس الرسالة تانى = ADF لسه سايبها فى الصفحة بعد الإغلاق، مش
        // رسالة جديدة. بنوقف بدل ما نضغط OK على حاجة اتقفلت أصلاً ونكتب سطر مضلّل.
        if (dlg === lastDlg || txt(dlg).replace(/\s+/g, " ").slice(0, 200) === lastDlgText) {
          logln("ℹ️ نفس الرسالة السابقة — مش رسالة جديدة.");
          break;
        }
        const CONFIRM_RE = /^\s*(yes|ok|confirm|submit|close|نعم|موافق|تأكيد|إغلاق)\s*$/i;
        const okBtn = qAll("button, a, input[type='submit'], span[role='button'], [role='menuitem'], td, div", dlg)
          .find((el) => visible(el) && !isDisabled(el) && CONFIRM_RE.test(txt(el)));
        if (!okBtn) { logln("🪟 نافذة ظهرت بس مفيش فيها زر موافقة."); break; }
        // بنسجّل نص النافذة قبل ما نقفلها — الرسالة بتتقفل فى أقل من ثانية فمابتلحقش
        // تتشاف على الشاشة، وده بيخلّيها موثّقة من غير ما نبنى عليها أى قرار.
        const dtxt = txt(dlg).replace(/\s+/g, " ").slice(0, 200);
        logln("🪟 نافذة " + d + ": " + (dtxt || "(بدون نص)"));
        // بنسيبها ظاهرة شوية قبل ما نقفلها عشان تلحق تتقرا على الشاشة — قبل كده كنا
        // بنضغط OK فى نفس اللحظة فمابتلحقش تتشاف، والمستخدم افتكرها بطلت تظهر.
        lastDlg = dlg; lastDlgText = dtxt;
        banner("🪟 " + (dtxt || "رسالة من WFM") , "#0277bd");
        await sleep(DIALOG_SHOW_MS);
        logln("   ↩️ بضغط «" + txt(okBtn) + "».");
        fireClick(okBtn);
        await waitIdle(10000);
        await sleep(800);
      }

      // (8) نتأكد إن الحالة اتغيّرت فعلاً. ⚠️ جدول النتائج **مابيتحدّثش لوحده** بعد
      //     Cancel/Assign — الحالة الجديدة مابتظهرش غير بعد إعادة تحميل/بحث. فقراءة
      //     الجدول على طول كانت بترجّع الحالة القديمة (وأحياناً نسخ متضاربة من نسخ
      //     ADF القديمة فى الـ DOM). فبنعيد البحث بنفس الرقم الأول، وبعدين نقرا.
      await waitIdle(15000);
      logln("🔁 بعيد البحث عشان الجدول يتحدّث…");
      const sid2 = findServiceIdInput();
      if (sid2) setValue(sid2, serviceId);
      const searchBtn2 = findSearchButton();
      if (searchBtn2) { fireClick(searchBtn2); await waitIdle(25000); }
      else logln("   ⚠️ مش لاقى زر Search لإعادة البحث — القراءة ممكن تبقى قديمة.");
      await sleep(1200);
      const after = await waitFor(() => {
        const r = readResultRows();
        return r.length ? r : null;
      }, 15000) || [];
      // نفس أمر الشغل بيتكرّر فى القراءة: ADF بيقسّم الجدول لجزء مجمّد وجزء متحرّك
      // (كل صف بيطلع مرتين)، وبيسيب نسخ قديمة فى الـ DOM. فبنجمّع الحالات المميّزة
      // لكل أمر شغل بدل ما ناخد أول واحد يقابلنا — اللى كان بيقع على نسخة قديمة.
      const uniq = [...new Set(after.map((r) => r.workOrderId + "=" + r.status))];
      logln("📋 بعد التنفيذ: " + (uniq.length ? uniq.join(" ، ") : "(الجدول فاضى)"));
      const wo = (candidates[0] && candidates[0].workOrderId) || "";
      const beforeStatus = ((candidates[0] && candidates[0].status) || "").trim();
      const matches = wo ? after.filter((r) => r.workOrderId === wo) : [];
      const statuses = [...new Set(matches.map((r) => r.status.trim()))];
      // بعد إعادة البحث القراءة بقت طازجة: أى حالة غير اللى كانت (أو اختفاء الصف من
      // النتائج) = العملية اتنفّذت.
      const changed = !wo ? after.length === 0
        : (!matches.length || statuses.some((st) => st.toLowerCase() !== beforeStatus.toLowerCase()));
      if (wo) logln("🔎 أمر الشغل " + wo + ": كان «" + beforeStatus + "» → " +
        (matches.length ? "«" + statuses.join("» / «") + "»" : "مابقاش فى النتائج"));
      if (changed) {
        // بنبلّغ Service-Flow إن الإلغاء اتم — السيرفر بيسجّل «مين طلبه» من op_intents
        // (نفس أسلوب القياس ورفع السرعة) عشان يظهر فى سجل العمليات.
        const st = ((candidates[0] && candidates[0].status) || "") +
          (MODE === "reassign" ? " → re-assigned to " + WORKER : " → canceled");
        const rep = await sfReportCancel(serviceId, st);
        const what = MODE === "reassign" ? "تم إسناد المهمة للعامل " + WORKER : "تم إلغاء إسناد المهمة";
        banner("✅ " + what + " للرقم " + serviceId + "." + (rep.ok ? "" : " (⚠️ التسجيل فى Service-Flow فشل: " + rep.error + ")"),
               rep.ok ? "#2e7d32" : "#ef6c00");
      } else {
        // ملحوظة: WFM بيرجّع المهمة للطابور لوحده بعد شوية من الإلغاء، فلو إعادة البحث
        // جت متأخرة ممكن نلاقى السطر رجع بنفس الحالة. بنقول ده بدل ما نجزم بالفشل.
        banner("⚠️ اتضغط «" + WANTED_LABEL + "» بس حالة السطر ما اتغيّرتش — راجع الشاشة" +
               (MODE === "cancel" ? " (ممكن يكون اتلغى وWFM رجّعه للطابور تانى)." : "."), "#ef6c00");
      }
      clearPending();   // نهاية مؤكّدة (نجاح أو ضغطة اتنفّذت) — مايتكررش لوحده
    } catch (e) {
      banner("❌ خطأ: " + (e && e.message || e), "#c62828");
      logln("❌ " + (e && e.stack || e));
    } finally {
      running = false;
      // ❗مابنمسحش الرقم هنا. الفشل المؤقّت (شاشة لسه بتحمّل، ADF مشغول، تنقّل جارٍ)
      // كان بيمسحه وإحنا فى نص النقلة فترجع الخانة فاضية. المسح بقى عند النهايات
      // المؤكّدة بس (نجاح / مفيش سطر مؤهّل / Cancel مش متاحة / استنفاد المحاولات).
    }
  }

  /* ================== البداية ================== */
  function boot() {
    if (!document.body) { setTimeout(boot, 300); return; }
    // التاب ده تاب «تحديث الملفات اليومية» لأوامر الشغل (بيفتحه سكربت TE All-in-One
    // باسم wfm_daily) — مالناش أى شغل عليه، فمانبنيش لوحة ولا نتدخّل أصلاً.
    let wn = ""; try { wn = window.name || ""; } catch (e) {}
    const pend0 = getPending();
    if (/wfm_daily/i.test(wn) && !pend0 && !/sf_cancel/i.test(location.hash || "")) return;
    buildPanel();
    banner("⚙️ Dispatcher Cancel — اكتب Service Id واضغط ابدأ.");
    // تشغيل تلقائى لو الرقم اتبعت فى الهاش: #sf_cancel=2653614
    // ملحوظة: المتصفح/التطبيق ممكن يرمّز علامة «=» لـ «%3D» — فبنقبل الاتنين.
    // وبنخزّن الرقم فى sessionStorage عشان يفضل موجود بعد ما ADF يغيّر الهاش أثناء التنقّل.
    const m = (location.hash || "").match(/sf_(?:reassign|cancel)(?:=|%3D)(\d+)/i);
    let pending = m ? m[1] : "";
    if (pending) {
      setPending(pending);
      // طلب جديد جاى فى الهاش → صفّر عدّاد محاولات الدخول المباشر. العدّاد بيعيش فى
      // sessionStorage بتاع التاب، والتاب بيتعاد استخدامه (sf_wfm)، فمن غير التصفير ده
      // كانت التشغيلة الجديدة بتتخطّى الدخول المباشر بسبب محاولة تشغيلة قديمة.
      try { [DIRECT_KEY, DIRECT_TS_KEY, PENDING_HOPS_KEY, RELOAD_KEY].forEach((k) => sessionStorage.removeItem(k)); } catch (e) {}
    } else {
      pending = getPending();
      // تحميل جديد على **صفحة الدخول** ومعانا طلب شغّال = محاولة نضيفة، حتى لو الهاش
      // اتمسح. من غير ده كان الريفريش بتاعنا مايفيدش (العدّادات فاضلة زى ما هى)
      // بينما الريفريش اليدوى بتاعك بيفيد لأن الوقت بيعدّى وتنتهى مهلة العدّاد.
      // عدّاد الـ hops فاضل هو الحد الأقصى الحقيقى للمحاولات.
      if (pending && !/\/Dispatcher\//i.test(location.pathname)) {
        try { [DIRECT_KEY, DIRECT_TS_KEY, RELOAD_KEY].forEach((k) => sessionStorage.removeItem(k)); } catch (e) {}
        logln("🧹 تحميل جديد على صفحة الدخول — صفّرت عدّادات التنقّل.");
      }
    }
    // الوضع وكود العامل بييجوا فى نفس الهاش: #sf_cancel=2746124&sf_mode=reassign&sf_worker=347817
    const mm = (location.hash || "").match(/sf_mode(?:=|%3D)(cancel|reassign)/i);
    const mw = (location.hash || "").match(/sf_worker(?:=|%3D)(\d+)/i);
    try {
      if (mm) sessionStorage.setItem(MODE_KEY, mm[1].toLowerCase());
      if (mw) sessionStorage.setItem(WORKER_KEY, mw[1]);
    } catch (e) {}
    // حد أقصى لعدد تحميلات الصفحة على نفس الطلب — يمنع اللف فى دايرة لو حاجة اتغيّرت
    if (pending) {
      let hops = 0; try { hops = Number(sessionStorage.getItem(PENDING_HOPS_KEY)) || 0; } catch (e) {}
      if (hops >= PENDING_MAX_HOPS) {
        logln("⛔ استنفدت المحاولات (" + hops + ") للرقم " + pending + " — بوقف.");
        clearPending(); pending = "";
      } else { try { sessionStorage.setItem(PENDING_HOPS_KEY, String(hops + 1)); } catch (e) {} }
    }
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
