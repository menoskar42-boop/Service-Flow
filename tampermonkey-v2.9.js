// ==UserScript==
// @name         TE FCC + WFM + OSS + SubInfo (All-in-One)
// @namespace    te.eg.autoexport
// @version      3.0.4
// @description  FCC + WFM + OSS export + جلب اسم/عنوان العميل — كله فى سكربت واحد. v3.0.4: إصلاح — التهدئة بقت *فقط* لو ظهرت رسالة رفض/قفل فعلية (Invalid username or password / LoginException). بطء تسجيل الدخول (لسه على صفحة الدخول من غير رسالة) مابيتحسبش فشل خالص — بنستنى بصبر لحد ما يخرج من صفحة الدخول (نجاح) أو تظهر رسالة (تهدئة). شِلنا عدّاد «محاولتين فاشلتين» اللى كان بيوقف الدخول بالغلط وقت التأخير. v3.0.3: قفل حساب FCC مؤقت (~20 دقيقة) — فترة تهدئة ~22 دقيقة (مشتركة عبر كل تابات FCC عبر localStorage) بعد رفض الدخول، وبعدها يحاول لوحده. v3.0.2: (1) علامة وضع المراجعة (sf_subinfo_one/auto) بتتثبّت فى sessionStorage عند document-start قبل ما FCC يمسح window.name — فزر «مراجعة» بقى يفتح Complains ويدخل رقم التليفون بدل ما يقع فى تدفّق التصدير. (2) الدخول يقف فوراً لو ظهرت «Invalid username or password». v3.0.1: المراجعة تفتح Complains بـ activate (زى بلاطة Ticket Queue) + حد 300 رقم لكل تشغيل (الباقى يكمّل الدورة الجاية). v3.0.0: دمجنا سكربت SubInfo هنا — تاب FCC اليومى بعد التصدير يراجع الأرقام (بورتات بدون بيانات فنية) فى نفس الدخول ثم يقفل؛ وزر المراجعة اليدوى (sf_subinfo_auto/one) بيشتغل لوحده. (احذف سكربت SubInfo المنفصل القديم). v2.40: فحص قفل الحساب (صارم — يقف فقط لو ظهرت رسالة LoginException بالظبط، مش بيمنع الدخول العادى). v2.39: رجعنا فحص القفل الفضفاض. v2.38: كشف قفل الحساب. v2.37: قفل دخول FCC مشترك يمنع الدخول المتزامن من تابين (تصدير + جلب اسم/عنوان) اللى بيسبّب LoginException. v2.36: سكربت التصدير يقف تماماً لو التاب اتفتح لجلب اسم/عنوان العميل (window.name=sf_subinfo_auto) — يمنع التعارض مع سكربت SubInfo الجديد. v2.35: OSS كمان يقفل بعد 15ث. v2.34: WFM يقفل بعد 15ث. v2.33: شِلنا حيلة open('','_self') من منطق الإغلاق — كانت بتبيّض صفحة WFM/OSS لو الإغلاق مانفعش (وتضطرك تعمل refresh). دلوقتى إغلاق عادى window.close() بس (بيشتغل لأن التابات مفتوحة بـ window.open ولها opener). v2.32: شِلنا الـ chaining — زر "حدّث التقارير اليومية" فى Service-Flow بقى يفتح FCC+WFM+OSS الثلاثة بالتوازى مباشرةً (أسرع وأضمن؛ السلسلة كانت بتتبلوك لأنها تفتح من داخل fcc.te.eg). كل تاب باسم ثابت (fcc_daily/wfm_daily/oss_daily) يُعاد استخدامه بدل التكديس. v2.31: تابات WFM/OSS تُفتح باسم ثابت عبر window.open زى FCC. v2.30: إغلاق أقوى لتاب WFM/OSS — نجرّب حيلة open('','_self') قبل window.close(). v2.29: WFM و OSS يقفلوا التاب تلقائياً بعد الرفع بدقيقة (60ث) دايماً (تابات أتمتة بحتة) — مش بس ضمن التدفّق اليومى. v2.28: رجّعنا دالة runWFM لنسخة يوم 10-7 (بند "تحميل اكسل" ثم زر Export بضغطة realClick بسيطة بدل activate) + حساب WFM = mina109756 — عشان تناسب الواجهة القديمة البسيطة. activate كان بيتسلّق لعناصر ADF ويشغّل _skipToContent اللى بيكراش ويوقف التصدير. v2.27: رجّعنا حساب دخول WFM لـ mina109756. v2.26: WFM — مراقبة تغيّر src على أى iframe (بما فيها afr::PushIframe الموجود أصلاً) لالتقاط تحميل ADF عبر PPR/iframe مخفى. v2.25: مراقبة الـ iframes المحقونة (MutationObserver) لالتقاط تحميل ADF عبر iframe مخفى (اللى مابيمرّش على fetch/XHR/submit)، + تسجيل تشخيصى لأى iframe/form بيتحقن أثناء الالتقاط. v2.24: WFM هى Oracle ADF (زى FCC) — نستخدم activate لضغط عنصر أمر التصدير الحقيقى (مش الـ div الداخلى) فيتم form submit ويتلقط. v2.23: اعتراض URL.createObjectURL لمسك ملف Excel المولَّد فى المتصفح (client-side blob) — HiveWorx. v2.22: قصر اعتراض fetch/XHR/الروابط على wfm.te.eg فقط (عشان ماتكسرش سلسلة FCC→WFM). v2.21: اعتراض fetch/XHR وضغطات روابط التحميل (blob/download) لواجهة HiveWorx اللى بتحمّل بدون form submit. v2.20: مستمع submit عام يمسك الإرسال الطبيعى (native form submit) لزر Export بتاع WFM. v2.19: إصلاح تصدير WFM بعد تغيير واجهة WE — يضغط بند "Export Excel" الصحيح ثم زر "Export" فى الـ popup (selector أوسع). v2.18: فتح التابات المتسلسلة بدون setParent. v2.17: قفل التاب تلقائياً بعد الرفع فى التدفّق اليومى.
// @match        https://fcc.te.eg/TroubleTicket/faces/*
// @match        https://wfm.te.eg/WorkOrder/faces/*
// @match        https://oss.te.eg:15201/om*
// @match        https://oss.te.eg:15204/cas/*
// @run-at       document-start
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      service-flow-menoskar42.replit.app
// @connect      replit.app
// @connect      replit.dev
// @connect      oss.te.eg
// @connect      fcc.te.eg
// @connect      wfm.te.eg
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  /* التقاط علامة وضع المراجعة من window.name فوراً (document-start) قبل ما FCC/ADF يمسحها،
     ونثبّتها فى sessionStorage عشان تفضل طول عمر التاب حتى بعد تسجيل الدخول والتنقّل بين صفحات FCC.
     (FCC بيعيد استخدام window.name لإدارة الـ frames فبيمسح علامتنا → كان زر المراجعة يقع فى تدفّق التصدير). */
  try {
    var _wn0 = window.name || '';
    if (_wn0 === 'sf_subinfo_auto' || _wn0.indexOf('sf_subinfo_one:') === 0) {
      sessionStorage.setItem('sf_si_mode', _wn0);
    }
  } catch (e) {}

  /* ================================================================
     ⚙️ CONFIG — لو رابط موقعك اتغير عدّله هنا فقط (من غير / في الآخر)
     ================================================================ */
  const SF_URL          = 'https://service-flow-menoskar42.replit.app';
  const SF_UPLOAD_TOKEN = 'sf-auto-upload-2026';
  /* ================================================================ */

  /* ---------- on-screen logger ---------- */
  const log = (() => {
    let box;
    return (...a) => {
      try { console.log('%c[TE]', 'color:#0a8', ...a); } catch (e) {}
      try {
        if (!box) {
          if (!document.body && !document.documentElement) return;
          box = document.createElement('div');
          box.style.cssText = 'position:fixed;z-index:2147483647;bottom:8px;right:8px;max-width:440px;max-height:48vh;overflow:auto;background:#0b1020;color:#7fffd4;font:12px/1.45 monospace;padding:8px 10px;border:1px solid #0a8;border-radius:8px;opacity:.95;white-space:pre-wrap;direction:ltr;text-align:left';
          (document.body || document.documentElement).appendChild(box);
        }
        const line = document.createElement('div');
        line.textContent = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
        box.appendChild(line); box.scrollTop = box.scrollHeight;
      } catch (e) {}
    };
  })();

  /* ---------- التشغيل التلقائى اليومى: قفل التاب بعد الرفع ----------
     زر "تحديث الملفات اليومية" فى Service-Flow بيفتح تاب FCC باسم target = "fcc_daily"
     (window.name). لو التاب ده هو اللى شغّال، نقفله بعد ما يرفع ملفه — عشان مايتكدّسش
     تابات مع التشغيل كل نص ساعة. والتابات المتسلسلة (WFM/OSS) بتعرف إنها ضمن نفس التدفّق
     عبر علامة زمنية فى GM storage (sf_daily_flow_at) بنجدّدها طول ما التدفّق شغّال. */
  const DAILY_AUTO = (() => { try { return window.name === 'fcc_daily'; } catch (e) { return false; } })();
  function markDailyFlow() { try { GM_setValue('sf_daily_flow_at', Date.now()); } catch (e) {} }
  function isDailyFlow() {
    try { return DAILY_AUTO || (Date.now() - GM_getValue('sf_daily_flow_at', 0) < 30 * 60 * 1000); }
    catch (e) { return DAILY_AUTO; }
  }
  let closingScheduled = false;
  let siAfterExport = false;   // على تاب FCC اليومى: بعد التصدير هنعمل مراجعة اسم/عنوان قبل الإغلاق
  // WFM و OSS تابات أتمتة بحتة → تتقفل دايماً بعد الرفع بـ 15ث. FCC → فقط ضمن التدفّق اليومى (بعد 4ث).
  const PURE_AUTO_HOST = /wfm\.te\.eg|oss\.te\.eg/i.test(location.host);
  function autoCloseIfDaily(reason) {
    if (closingScheduled) return;
    // على FCC لو هنعمل مراجعة بعد التصدير — مانقفلش، المراجعة هى اللى هتقفل التاب فى الآخر
    if (siAfterExport && /fcc\.te\.eg/i.test(location.host)) { log('⏭ FCC: مراجعة بعد التصدير — تأجيل الإغلاق'); return; }
    if (!PURE_AUTO_HOST && !isDailyFlow()) return;
    closingScheduled = true;
    // WFM و OSS: 15ث بعد ما الرفع يخلص. FCC: 4ث.
    const delay = PURE_AUTO_HOST ? 15000 : 4000;
    log('✅ ' + (reason || 'انتهى') + ' — إغلاق التبويب بعد ' + (delay / 1000) + 'ث (تحديث تلقائى)');
    // window.close() بيشتغل على التابات المفتوحة بـ window.open (لها opener) — زى ما Service-Flow
    // بيفتح FCC/WFM/OSS. مابنستخدمش حيلة open('','_self') لأنها بتبيّض الصفحة لو الإغلاق مانفعش.
    setTimeout(() => { try { window.close(); } catch (e) {} }, delay);
  }

  /* ---------- Service-Flow upload ---------- */
  function uploadToSF(blob, filename, endpoint) {
    if (!SF_URL || SF_URL.includes('YOUR-SERVICE-FLOW')) { log('⚠️ SF_URL غير مضبوط'); return; }
    log('📤 رفع إلى SF:', endpoint, '(' + Math.round(blob.size / 1024) + ' KB)');
    const fd = new FormData(); fd.append('file', blob, filename);
    GM_xmlhttpRequest({
      method: 'POST', url: SF_URL + endpoint,
      headers: { 'X-Upload-Token': SF_UPLOAD_TOKEN },
      data: fd, timeout: 60000,
      onload: r => { try { log('✅ SF:', JSON.stringify(JSON.parse(r.responseText))); } catch (e) { log('✅ SF', r.status, (r.responseText || '').slice(0, 120)); } autoCloseIfDaily('تم الرفع'); },
      onerror: r => { log('❌ SF error — status:', (r && r.status), '|', (r && (r.error || r.statusText || r.finalUrl)) || 'فشل الاتصال'); autoCloseIfDaily('فشل الرفع'); },
      ontimeout: () => { log('❌ SF timeout (60s)'); autoCloseIfDaily('انتهت المهلة'); },
    });
  }

  function isFileHeaders(cd, ct) {
    const s = ((cd || '') + ' ' + (ct || '')).toLowerCase();
    return s.includes('attachment') || s.includes('vnd.ms-excel') || s.includes('vnd.openxmlformats') || s.includes('octet-stream') || s.includes('application/xls') || s.includes('spreadsheet');
  }
  // فحص أول بايتات الملف: xlsx يبدأ بـ PK (50 4B)، xls القديم بـ D0 CF
  function looksExcel(u8) { return (u8[0] === 0x50 && u8[1] === 0x4B) || (u8[0] === 0xD0 && u8[1] === 0xCF); }
  function isXlsExt(u8) { return u8[0] === 0xD0 && u8[1] === 0xCF; }

  /* ---------- capture arming ---------- */
  let armed = null;
  function armCapture(filename, endpoint, label) {
    armed = { filename, endpoint, label }; log('🔫 armed capture:', label);
    setTimeout(() => { if (armed && armed.label === label) { armed = null; log('⏱ disarmed (timeout):', label); } }, 45000);
  }

  function serializeForm(form) {
    const params = new URLSearchParams();
    Array.from(form.querySelectorAll('input, select, textarea')).forEach(inp => {
      if (!inp.name || inp.type === 'file') return;
      if ((inp.type === 'checkbox' || inp.type === 'radio') && !inp.checked) return;
      params.append(inp.name, inp.value || '');
    });
    return params;
  }

  // يُنزّل الـ blob للديسك يدوياً بدل الـ form submit الأصلى (بعد ما نرفعه لـ SF)
  function saveToDisk(buf, filename) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf]));
      a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(a.href); } catch(e){} }, 2000);
      log('💾 saved to disk:', filename);
    } catch(e) { log('disk save err:', e.message); }
  }

  // يُستدعى من hook الـ submit — يلتقط الطلب الحقيقى ويوقف الـ submit الأصلى
  // (نمنع التنافس على ADF token: نحن نأخذه، ونُنزّل الملف يدوياً بعدين)
  // يرجع true لو التقط الطلب، false لو يجب السماح للـ submit الأصلى بالمرور.
  function captureFromForm(form) {
    const cap = armed; armed = null;
    let params, action;
    try { params = serializeForm(form); action = form.getAttribute('action') || form.action || location.href; }
    catch (e) { log('serialize error:', e.message); return false; }
    log('📸 captured submit →', String(action).slice(0, 80), '| params:', Array.from(params.keys()).length);
    (async () => {
      try {
        const res = await fetch(action, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), redirect: 'follow' });
        const cd = res.headers.get('Content-Disposition') || '', ct = res.headers.get('Content-Type') || '';
        log('📥 resp:', res.status, '| CT:', ct.slice(0, 40), '| CD:', cd.slice(0, 50));
        const buf = await res.arrayBuffer(); const u8 = new Uint8Array(buf);
        if (res.status === 200 && (isFileHeaders(cd, ct) || (looksExcel(u8) && buf.byteLength > 100))) {
          log('✅ got blob:', buf.byteLength, 'bytes', looksExcel(u8) ? '(magic)' : '(headers)');
          uploadToSF(new Blob([buf]), cap.filename, cap.endpoint);
          saveToDisk(buf, cap.filename);
          return;
        }
        const text = new TextDecoder('utf-8', { fatal: false }).decode(u8);
        const redir = text.match(/<redirect\s+url="([^"]+)"/i) || text.match(/href="([^"]*(?:download|export|\.xls)[^"]*)"/i);
        if (redir) {
          const u = redir[1].replace(/&amp;/g, '&'); const u2 = u.startsWith('http') ? u : location.origin + u;
          log('↪ follow:', u2.slice(0, 80));
          const r2 = await fetch(u2, { credentials: 'include' });
          const b2 = await r2.arrayBuffer(); const v2 = new Uint8Array(b2);
          if (r2.status === 200 && (isFileHeaders(r2.headers.get('Content-Disposition') || '', r2.headers.get('Content-Type') || '') || (looksExcel(v2) && b2.byteLength > 100))) {
            log('✅ blob after redirect:', b2.byteLength);
            uploadToSF(new Blob([b2]), cap.filename, cap.endpoint);
            saveToDisk(b2, cap.filename);
          } else log('❌ redirect ليس ملفاً.');
          return;
        }
        log('❌ لا ملف ولا redirect. preview:', text.replace(/\s+/g, ' ').slice(0, 180));
      } catch (e) { log('❌ capture fetch error:', e.message); }
    })();
    return true; // التقطنا — لا تُشغّل الـ submit الأصلى
  }

  // يرفع bytes لو شكلها ملف Excel (من fetch/XHR/blob) — يُستخدم للواجهات اللى بتحمّل بدون form submit (HiveWorx)
  function tryUploadBytes(buf, ct, cd, via) {
    if (!armed || !buf || buf.byteLength <= 100) return false;
    const u8 = new Uint8Array(buf);
    if (isFileHeaders(cd || '', ct || '') || looksExcel(u8)) {
      const cap = armed; armed = null;
      log('📸 captured ' + via + ':', buf.byteLength, 'bytes');
      uploadToSF(new Blob([buf]), cap.filename, cap.endpoint);
      saveToDisk(buf, cap.filename);
      return true;
    }
    return false;
  }

  /* ---------- hooks (document-start) ---------- */
  (function installHooks() {
    try {
      const wrapSubmit = orig => function () {
        if (armed) {
          let handled = false;
          try { handled = captureFromForm(this); } catch (e) { log('hook err:', e.message); }
          if (handled) return; // نحن نتحكم في الـ download — لا تُشغّل الـ submit الأصلى
        }
        return orig.apply(this, arguments);
      };
      HTMLFormElement.prototype.submit = wrapSubmit(HTMLFormElement.prototype.submit);
      if (HTMLFormElement.prototype.requestSubmit) HTMLFormElement.prototype.requestSubmit = wrapSubmit(HTMLFormElement.prototype.requestSubmit);
    } catch (e) {}
    // capture-phase submit EVENT — يمسك الإرسال الطبيعى (native form submit) الناتج عن ضغطة زر
    // (زى Export بتاع WFM الجديد) — لأن prototype.submit hook بيمسك الإرسال البرمجى فقط.
    try {
      document.addEventListener('submit', function (e) {
        if (!armed) return;
        const f = e.target;
        if (f && f.tagName === 'FORM') {
          let handled = false;
          try { handled = captureFromForm(f); } catch (err) { log('submit-event hook err:', err.message); }
          if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
        }
      }, true);
    } catch (e) {}
    try {
      const origOpen = window.open;
      window.open = function (url) {
        if (armed && url && /download|export|\.xls/i.test(String(url))) {
          const cap = armed; armed = null; const u = String(url); const u2 = u.startsWith('http') ? u : location.origin + u;
          log('📸 captured window.open →', u2.slice(0, 80));
          fetch(u2, { credentials: 'include' }).then(async r => {
            const b = await r.arrayBuffer(); const v = new Uint8Array(b);
            if (r.status === 200 && (isFileHeaders(r.headers.get('Content-Disposition') || '', r.headers.get('Content-Type') || '') || (looksExcel(v) && b.byteLength > 100))) { log('✅ blob via open:', b.byteLength); uploadToSF(new Blob([b]), cap.filename, cap.endpoint); }
            else log('❌ window.open URL ليس ملفاً.');
          }).catch(e => log('❌ open fetch:', e.message));
        }
        return origOpen.apply(this, arguments);
      };
    } catch (e) {}
    // الـ hooks التالية (fetch/XHR/ضغطات روابط التحميل) مطلوبة لـ WFM (HiveWorx) فقط — بنقصرها عليه
    // عشان ماتتداخلش مع تدفّق FCC/OSS المجرَّب (اللى بيعتمد على form submit / GM_xmlhttpRequest).
    if (/wfm\.te\.eg/i.test(location.host)) {
    // hook fetch — لو armed ولاقى استجابة ملف Excel، ارفعها (لواجهات بتحمّل عبر fetch/blob زى HiveWorx)
    try {
      const _fetch = window.fetch;
      window.fetch = function (...args) {
        const p = _fetch.apply(this, args);
        if (armed) {
          p.then(resp => {
            try {
              if (!armed || !resp || resp.status !== 200) return;
              const cd = resp.headers.get('content-disposition') || '', ct = resp.headers.get('content-type') || '';
              // نفحص البايتات فقط لو الاستجابة يُحتمل تكون ملف (نتجنّب قراءة JSON/HTML)
              if (!(isFileHeaders(cd, ct) || /octet|excel|spreadsheet|download|xls/i.test(ct) || ct === '')) return;
              resp.clone().arrayBuffer().then(buf => tryUploadBytes(buf, ct, cd, 'fetch')).catch(() => {});
            } catch (e) {}
          }).catch(() => {});
        }
        return p;
      };
    } catch (e) {}
    // hook XHR — نفس الفكرة (لو الاستجابة arraybuffer شكلها ملف)
    try {
      const _open = XMLHttpRequest.prototype.open, _send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) { this.__sfUrl = u; return _open.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        this.addEventListener('load', function () {
          try {
            if (!armed || this.status !== 200) return;
            const cd = this.getResponseHeader('content-disposition') || '', ct = this.getResponseHeader('content-type') || '';
            if (!(isFileHeaders(cd, ct) || /octet|excel|spreadsheet|download|xls/i.test(ct))) return;
            if (this.response instanceof ArrayBuffer) { tryUploadBytes(this.response, ct, cd, 'xhr'); return; }
            if (this.__sfUrl) {
              const cap = armed;
              const u2 = String(this.__sfUrl).startsWith('http') ? String(this.__sfUrl) : location.origin + String(this.__sfUrl);
              fetch(u2, { credentials: 'include' }).then(async r => {
                const b = await r.arrayBuffer();
                if (armed === cap) tryUploadBytes(b, r.headers.get('content-type') || '', r.headers.get('content-disposition') || '', 'xhr-refetch');
              }).catch(() => {});
            }
          } catch (e) {}
        });
        return _send.apply(this, arguments);
      };
    } catch (e) {}
    // hook ضغطات روابط التحميل (<a download> أو href فيه blob:/download/export/.xls) — يشمل الضغط البرمجى
    try {
      document.addEventListener('click', function (e) {
        if (!armed) return;
        const a = e.target && e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        const href = a.getAttribute('href') || '';
        if (!(a.hasAttribute('download') || /^blob:|download|export|\.xlsx?(\?|$)/i.test(href))) return;
        const cap = armed;
        const u2 = /^(https?:|blob:)/i.test(href) ? href : location.origin + href;
        fetch(u2, { credentials: 'include' }).then(async r => {
          const b = await r.arrayBuffer();
          if (armed === cap) tryUploadBytes(b, r.headers.get('content-type') || '', r.headers.get('content-disposition') || '', 'anchor');
        }).catch(() => {});
      }, true);
    } catch (e) {}
    // hook URL.createObjectURL — أقوى مسار: HiveWorx بيولّد ملف Excel فى المتصفح (client-side) وينزّله كـ blob.
    // أول ما يتعمل blob للملف نمسكه ونرفعه مباشرة (البلوب هو الملف). saveToDisk بتاعنا مش بيتأثر لأنه بيشتغل وقت armed=null.
    try {
      const _createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (obj) {
        const url = _createObjectURL(obj);
        try {
          if (armed && (obj instanceof Blob) && obj.size > 100) {
            const cap = armed;
            obj.arrayBuffer().then(buf => {
              if (armed !== cap) return;
              const u8 = new Uint8Array(buf);
              const t = (obj.type || '').toLowerCase();
              if (looksExcel(u8) || /excel|spreadsheet|octet|ms-excel/.test(t)) {
                armed = null;
                log('📸 captured blob (createObjectURL):', buf.byteLength, 'bytes | type:', t || '—');
                uploadToSF(new Blob([buf]), cap.filename, cap.endpoint);
              }
            }).catch(() => {});
          }
        } catch (e) {}
        return url;
      };
    } catch (e) {}
    // hook تحميل عبر iframe مخفى — Oracle ADF (af:exportCollectionActionListener) بيبثّ الملف
    // كثيراً عن طريق حقن <iframe> جديد أو تغيير src بتاعه للـ URL بتاع التصدير. الـ hooks فوق
    // (fetch/XHR/submit) مابتمسكش ده. هنا نراقب أى iframe يتضاف/يتغيّر src وهو armed، ونجيب الملف.
    // كمان بنسجّل أى iframe/form بيتحقن أثناء الالتقاط عشان التشخيص لو فضل مش شغّال.
    try {
      const tryIframeSrc = (src) => {
        if (!armed || !src || /^about:blank$/i.test(src)) return;
        if (!/download|export|xls|report|attach|blob:|servlet|\.do(\?|$)/i.test(src)) { log('👀 iframe src (armed):', String(src).slice(0, 90)); return; }
        const cap = armed;
        const u2 = /^(https?:|blob:)/i.test(src) ? src : location.origin + src;
        log('📸 iframe download candidate →', u2.slice(0, 90));
        fetch(u2, { credentials: 'include' }).then(async r => {
          const b = await r.arrayBuffer();
          if (armed === cap) tryUploadBytes(b, r.headers.get('content-type') || '', r.headers.get('content-disposition') || '', 'iframe');
        }).catch(e => log('iframe fetch err:', e.message));
      };
      const watchIframe = (fr) => {
        try { if (fr.src) tryIframeSrc(fr.src); } catch (e) {}
        try { new MutationObserver(() => { try { tryIframeSrc(fr.src); } catch (e) {} }).observe(fr, { attributes: true, attributeFilter: ['src'] }); } catch (e) {}
      };
      new MutationObserver((muts) => {
        if (!armed) return;
        for (const m of muts) {
          // تغيّر src على أى iframe (بما فيها afr::PushIframe الموجود أصلاً) — ده مسار تحميل ADF (PPR)
          if (m.type === 'attributes' && m.target && m.target.tagName === 'IFRAME') {
            log('👁 iframe src changed (armed):', (m.target.getAttribute('src') || '—').slice(0, 90));
            try { tryIframeSrc(m.target.src); } catch (e) {}
            continue;
          }
          for (const n of m.addedNodes) {
            if (!n.tagName) continue;
            if (n.tagName === 'IFRAME') { log('👁 iframe added (armed) src:', (n.getAttribute('src') || '—').slice(0, 90)); watchIframe(n); }
            else if (n.tagName === 'FORM') { log('👁 form added (armed) action:', (n.getAttribute('action') || '—').slice(0, 60), '| target:', n.getAttribute('target') || '—'); }
            else if (n.querySelectorAll) { n.querySelectorAll('iframe').forEach(watchIframe); }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    } catch (e) {}
    } // نهاية hooks الخاصة بـ WFM فقط
  })();

  /* ---------- anti-devtool guard ---------- */
  (function () {
    try { const _alert = window.alert ? window.alert.bind(window) : null; window.alert = function (m) { const s = String(m == null ? '' : m).toLowerCase(); if (s.includes('console') || s.includes('devtool') || s.includes('prohibit')) return; return _alert ? _alert(m) : undefined; }; } catch (e) {}
    try { console.clear = function () {}; } catch (e) {}
    setInterval(function () { try { const lays = document.querySelectorAll('.layui-layer'); for (let i = 0; i < lays.length; i++) { const lay = lays[i]; const t = (lay.textContent || '').toLowerCase(); if (t.includes('console') || t.includes('devtool') || t.includes('prohibit')) { const ok = lay.querySelector('.layui-layer-btn0') || lay.querySelector('.layui-layer-close'); if (ok) { try { ok.click(); } catch (e) {} } else { try { lay.remove(); } catch (e) {} } } } } catch (e) {} }, 1000);
  })();

  const CREDS = { 'fcc.te.eg': { user: 'mena.haleem', pass: 'Mon_oskar364' }, 'wfm.te.eg': { user: 'mina109756', pass: 'Mon_oskar11' }, 'oss.te.eg:15204': { user: 'MENA.HALEEM', pass: 'Mon_oskar364' } };
  const LOGIN_URL = { 'fcc.te.eg': 'https://fcc.te.eg/TroubleTicket/faces/security/pages/Login.jsf', 'wfm.te.eg': 'https://wfm.te.eg/WorkOrder/faces/security/pages/Login.jsf', 'oss.te.eg:15201': 'https://oss.te.eg:15201/om', 'oss.te.eg:15204': 'https://oss.te.eg:15201/om' };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm  = s  => (s || '').replace(/\s+/g, ' ').trim();
  async function waitFor(predicate, { timeout = 30000, interval = 400, label = '' } = {}) { const start = Date.now(); while (Date.now() - start < timeout) { let v; try { v = predicate(); } catch (e) { v = null; } if (v) return v; await sleep(interval); } throw new Error('waitFor timeout: ' + label); }
  function byText(root, selector, text, { exact = true, ci = true } = {}) { let t = norm(text); if (ci) t = t.toLowerCase(); return Array.from(root.querySelectorAll(selector)).find(el => { let c = norm(el.textContent || el.value || ''); if (ci) c = c.toLowerCase(); return exact ? c === t : c.includes(t); }); }
  function bestText(root, selector, needle) { const n = norm(needle).toLowerCase(); let best = null, bestLen = Infinity; Array.from(root.querySelectorAll(selector)).forEach(el => { const txt = norm(el.textContent).toLowerCase(); if (txt.includes(n) && txt.length < bestLen) { best = el; bestLen = txt.length; } }); return best; }
  function fire(el, type) { try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); } catch (e) {} }
  function realClick(el) { if (!el) return false; try { el.scrollIntoView({ block: 'center' }); } catch (e) {} try { ['mousedown', 'mouseup', 'click'].forEach(t => fire(el, t)); } catch (e) { try { el.click(); } catch (e2) {} } return true; }
  function setField(el, value) { if (!el) return; try { el.focus(); } catch (e) {} try { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); } catch (e) { el.value = value; } ['input', 'change', 'blur', 'keyup'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); }
  function looksBroken() { const t = norm(document.body ? document.body.textContent : '').toLowerCase(); return /internal server error|http status 500|error 500|the server encountered an unexpected/.test(t); }
  async function activate(el, done) { const ok = () => done ? done() : false; let card = el, clickable = null; for (let i = 0; i < 6 && card; i++) { clickable = card.querySelector('a[href], a[onclick], a[role="button"], a, [onclick], [role="button"]'); if (clickable) break; card = card.parentElement; } const targets = []; if (clickable) targets.push(clickable); targets.push(el); if (card && card !== el && targets.indexOf(card) === -1) targets.push(card); for (const t of targets) { if (ok()) return true; try { t.click(); } catch (e) {} await sleep(1700); if (ok()) return true; realClick(t); await sleep(1700); if (ok()) return true; fire(t, 'dblclick'); await sleep(1500); if (ok()) return true; } return ok(); }

  function captureGetHref(el, filename, endpoint) {
    const href = (el.href || '').trim(); if (!href || /^(javascript|#|about:)/i.test(href)) return false;
    log('Trying GET href:', href.slice(0, 80));
    fetch(href, { credentials: 'include', redirect: 'follow' }).then(async res => { const b = await res.arrayBuffer(); const v = new Uint8Array(b); if (res.status === 200 && (isFileHeaders(res.headers.get('Content-Disposition') || '', res.headers.get('Content-Type') || '') || (looksExcel(v) && b.byteLength > 100))) { log('✅ blob via href:', b.byteLength); uploadToSF(new Blob([b]), filename, endpoint); } else log('GET href ليس ملفاً → نعتمد على hook الـ submit'); }).catch(e => log('GET href err:', e.message));
    return true;
  }

  /* ---------- login ---------- */
  // قفل دخول FCC مشترك (localStorage على fcc.te.eg) — يمنع الدخول المتزامن من تابين بنفس الحساب
  // (تاب التصدير fcc_daily + تاب جلب الاسم/العنوان sf_subinfo_auto) اللى بيسبّب LoginException.
  async function acquireFccLock() {
    if (!/fcc\.te\.eg/i.test(location.host)) return;
    const KEY = 'sf_fcc_login_lock';
    for (let i = 0; i < 30; i++) {
      let held = 0; try { held = Number(localStorage.getItem(KEY) || 0); } catch (e) {}
      if (!held || Date.now() - held > 20000) { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} return; }
      log('⏳ انتظار قفل دخول FCC (تاب تانى بيسجّل دخول)...'); await sleep(1500);
    }
  }
  function releaseFccLock() { if (/fcc\.te\.eg/i.test(location.host)) setTimeout(() => { try { localStorage.removeItem('sf_fcc_login_lock'); } catch (e) {} }, 9000); }
  // كشف قفل الحساب — صارم: يتفعّل فقط لو ظهرت رسالة LoginException بالظبط (مش هيمنع الدخول العادى)
  function loginBlocked() { const t = norm(document.body ? document.body.textContent : '').toLowerCase(); return /loginexception|unexpected error during login/.test(t); }
  // كشف رفض البيانات/قفل الحساب المؤقت — FCC بيعرض «Invalid username or password» لمّا الحساب يتقفل مؤقتاً (~20 دقيقة)
  function loginRejected() { const t = norm(document.body ? document.body.textContent : '').toLowerCase(); return /invalid\s+username\s+or\s+password|invalid\s+user\s+name\s+or\s+password|authentication\s+failed|اسم المستخدم أو كلمة المرور|بيانات الدخول غير صحيحة/.test(t); }
  // فترة تهدئة: بعد رفض/قفل نوقف الدخول التلقائى ~22 دقيقة (أطول من قفل FCC ~20 دقيقة) ثم نسمح بالمحاولة تانى
  // العدّاد والتهدئة فى localStorage (مشتركة عبر كل تابات fcc.te.eg) عشان تاب المراجعة وتاب التصدير مايضغطوش سوا.
  const LOGIN_LOCK_MS = 22 * 60 * 1000;
  function loginCooldownLeft() { try { return Math.max(0, Number(localStorage.getItem('sf_login_cd') || 0) - Date.now()); } catch (e) { return 0; } }
  function startLoginCooldown(why) { try { localStorage.setItem('sf_login_cd', String(Date.now() + LOGIN_LOCK_MS)); } catch (e) {} log('⛔ إيقاف الدخول التلقائى ~' + Math.round(LOGIN_LOCK_MS / 60000) + ' دقيقة (' + why + ') — الحساب بيرجع لوحده بعد ~ثلث ساعة.'); }
  async function doLogin() {
    const onLogin = () => /Login\.jsf/i.test(location.href) || /\/cas\//i.test(location.href);
    // لو إحنا فى فترة تهدئة (قفل مؤقت) — مانحاولش الدخول خالص لحد ما تعدّى (الحساب بيرجع لوحده)
    const cdLeft = loginCooldownLeft();
    if (cdLeft > 0) { log('⏸ الدخول موقوف مؤقتاً — باقى ~' + Math.ceil(cdLeft / 60000) + ' دقيقة (الحساب بيرجع لوحده).'); return; }
    // لو الصفحة فيها رسالة رفض/قفل من محاولة سابقة → تهدئة
    if (loginBlocked()) { startLoginCooldown('LoginException'); return; }
    if (loginRejected()) { startLoginCooldown('الحساب مقفول مؤقتاً / بيانات مرفوضة'); return; }
    const okDone = () => { try { localStorage.removeItem('sf_login_cd'); } catch (e) {} };
    // بعد ضغط الدخول: نستنى بصبر — النجاح = خرجنا من صفحة الدخول، القفل = ظهرت رسالة رفض/قفل.
    // مهم: التأخير أو بطء تسجيل الدخول (لسه على صفحة الدخول من غير رسالة) *مش* اعتباره فشل → منعملش تهدئة.
    async function waitLoginResult(ms) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (!onLogin()) return 'ok';
        if (loginRejected() || loginBlocked()) return 'blocked';
        await sleep(500);
      }
      return 'timeout';
    }
    await acquireFccLock(); releaseFccLock();
    const c = CREDS[location.host];
    if (c && c.pass) { const pw = await waitFor(() => document.querySelector('input[type=password]'), { timeout: 15000, interval: 300, label: 'password' }).catch(() => null); if (pw) { const scope = pw.closest('form') || document; const userEl = scope.querySelector('input[type=text]') || document.querySelector('input[type=text]'); setField(userEl, c.user); setField(pw, c.pass); log('filled credentials:', c.user); await sleep(400); } }
    const TERMS = ['login','log in','log on','logon','sign in','signin','تسجيل الدخول','تسجيل دخول','دخول','الدخول'];
    const labelOf = el => norm(el.value)||norm(el.textContent)||norm(el.alt)||norm(el.getAttribute('aria-label'))||norm(el.title);
    const isLogin = el => { const l = labelOf(el).toLowerCase(); return l.length > 0 && l.length <= 24 && TERMS.some(t => l.includes(t)); };
    const rank = el => { const tag = el.tagName.toLowerCase(), type = (el.type||'').toLowerCase(); if (tag==='input'&&(type==='submit'||type==='image')) return 0; if (tag==='button') return 1; if (tag==='a'&&el.getAttribute('onclick')) return 2; if (tag==='input'&&type==='button') return 3; return 4; };
    let cands = [];
    try { await waitFor(() => { cands = Array.from(document.querySelectorAll('input[type=submit],button,input[type=image],input[type=button],a[onclick],a[role=button],a')).filter(isLogin).sort((a,b)=>rank(a)-rank(b)); return cands.length; }, { timeout: 20000, interval: 400, label: 'login candidates' }); } catch (e) {}
    // نجرّب أول مرشّح فقط (زر الدخول الحقيقى غالباً أول واحد بعد ترتيب rank) — أقل عدد إرسالات
    const btn = cands[0];
    if (!btn) { log('⚠️ مالقيتش زر الدخول.'); return; }
    try { btn.click(); } catch (e) {}
    // لو الضغطة الأولى مانقلتناش ومفيش رسالة، نجرّب realClick مرة واحدة كمان بعد لحظة
    let res = await waitLoginResult(4000);
    if (res === 'timeout') { realClick(btn); res = await waitLoginResult(12000); }
    if (res === 'ok') { log('LOGIN OK'); okDone(); return; }
    if (res === 'blocked') {
      if (loginRejected()) startLoginCooldown('الحساب مقفول مؤقتاً / بيانات مرفوضة');
      else startLoginCooldown('LoginException');
      return;
    }
    // timeout من غير أى رسالة = تسجيل الدخول لسه بيحمّل أو بطيء — *مش* فشل، مفيش تهدئة.
    log('STILL on login — لسه بيحمّل غالباً (مفيش رسالة رفض) → مش هعمل تهدئة.');
  }

  // ملاحظة: بنفتح التاب المتسلسل مستقلاً (بدون setParent) — عشان لما تاب FCC يقفل نفسه (v2.17+)
  // مايأثّرش على تاب WFM الابن ويقفله معاه. قفل التاب المتسلسل بيتم من autoCloseIfDaily بعد رفعه.
  // نفتح التاب المتسلسل باسم ثابت (window.name) عشان يُعاد استخدام نفس التاب كل مرة بدل تكديس تابات جديدة
  // مع التشغيل كل نص ساعة. لو النوافذ المنبثقة متبلوكة (window.open رجّع null) نرجع لـ GM_openInTab.
  function chainTo(key, url, name) {
    try {
      const last = GM_getValue(key, 0);
      if (Date.now() - last > 60000) {
        GM_setValue(key, Date.now());
        let w = null;
        try { w = window.open(url, name || '_blank'); } catch (e) {}
        if (w) { log('opening (reuse ' + (name || '') + ')', url); }
        else { try { GM_openInTab(url, { active: true }); } catch (e2) {} log('opening (GM tab)', url); }
      }
    } catch (e) { log('chain error:', e.message); }
  }

  /* =======================================================================
     FCC  (Ticket Queue)
     ===================================================================== */
  const fccHasSearch = () => document.querySelector('[id$="SearchOptions:_search"], [id$=":_search"]');
  async function runFCC() {
    log('FCC flow');
    if (/Login\.jsf/i.test(location.href)) { await doLogin(); return; }
    if (/\/faces\/(Home|UIShell)/i.test(location.href) && !fccHasSearch()) {
      const TILE_SEL = 'a,button,span,td,div,h1,h2,h3,h4,p'; let tile;
      try { tile = await waitFor(() => bestText(document, TILE_SEL, 'قائمة الشكاو') || bestText(document, TILE_SEL, 'ticket queue') || bestText(document, TILE_SEL, 'قائمة') || bestText(document, TILE_SEL, 'ticket') || bestText(document, TILE_SEL, 'queue'), { label: 'Ticket Queue tile', timeout: 20000 }); } catch (e) { log('tile not found:', e.message); }
      if (tile) { log('tile ->', tile.tagName, norm(tile.textContent).slice(0, 24)); const opened = await activate(tile, () => fccHasSearch()); if (!opened) log('tile did NOT open.'); }
    }
    const searchWrap = await waitFor(() => document.querySelector('[id$="SearchOptions:_search"]') || document.querySelector('[id$=":_search"]'), { label: 'search button', timeout: 25000 });
    realClick(searchWrap.querySelector('a[role="button"], a') || searchWrap);
    log('search clicked'); await sleep(4000);
    const exportLink = await waitFor(() => byText(document, 'a', 'تصدير', { exact: true }) || byText(document, 'a,button,input[type=submit]', 'Export', { exact: false }), { label: 'export button', timeout: 25000 });
    log('export — href:', (exportLink.href||'').slice(0,60), '| onclick:', (exportLink.getAttribute('onclick')||'—').slice(0,90));
    captureGetHref(exportLink, 'fcc_ticket_queue.xls', '/api/ticket-queue/import');
    armCapture('fcc_ticket_queue.xls', '/api/ticket-queue/import', 'FCC');
    realClick(exportLink);
    log('FCC export clicked. DONE.');
    // نفس التاب بعد التصدير: مراجعة الأرقام (بورتات بدون بيانات فنية) بنفس الدخول ثم يقفل — بشكل مبدئى.
    // بنرجع لصفحة Home عشان نلاقى بلاطة Complains (مش موجودة جوه Ticket Queue)، وبعلامة sessionStorage
    // عشان لما الصفحة تعيد التحميل مانعيدش التصدير — ندخل طور المراجعة على طول.
    if (isDailyFlow()) {
      siAfterExport = true;   // يمنع الإغلاق المبكر بعد رفع التصدير
      await sleep(6000);      // نسيب ملف التصدير يترفع الأول (GM_xmlhttpRequest بيكمّل حتى بعد التنقّل)
      try { sessionStorage.setItem('sf_fcc_phase', 'review'); } catch (e) {}
      log('↪ FCC: توجيه للـ Home لبدء المراجعة');
      location.href = 'https://fcc.te.eg/TroubleTicket/faces/Home';
    }
  }

  /* =======================================================================
     WFM  (Maintenance Orders)
     ===================================================================== */
  async function runWFM() {
    log('WFM flow');
    if (/Login\.jsf/i.test(location.href)) { const goHome = Array.from(document.querySelectorAll('a, button, input[type=button], input[type=submit]')).find(el => /go\s*to\s*home|homepage/i.test(norm(el.textContent || el.value || ''))); if (goHome) { log('WFM: already logged in → Go to Home'); realClick(goHome); return; } await doLogin(); return; }
    const opsMenu = () => bestText(document,'a,div,span,td,button,li','العمليات') || bestText(document,'a,div,span,td,button,li','operations');
    if (!opsMenu()) { let wo; try { wo = await waitFor(() => bestText(document,'a,button,span,td,div,h1,h2,h3,h4,p','طلبات العمل') || bestText(document,'a,button,span,td,div,h1,h2,h3,h4,p','work order'), { label:'Work Orders tile', timeout:15000 }); } catch (e) { log('Work Orders not found:', e.message); } if (wo) { log('WO ->',wo.tagName,norm(wo.textContent).slice(0,24)); await activate(wo, opsMenu); } }
    const ops = await waitFor(opsMenu, { label:'Operations menu', timeout:20000 });
    realClick(ops); const opsLink = ops.closest('a')||ops.querySelector('a'); if (opsLink && opsLink!==ops) realClick(opsLink); await sleep(1300);
    // الواجهة الجديدة: بند "Export Excel" فى قائمة operations (نفضّله بالنص الكامل عشان مانضغطش عنصر غلط زى "TD Export Excel")
    // نسخة يوم 10-7 (الواجهة القديمة البسيطة بحساب mina109756): بند "تحميل اكسل" ثم زر "Export" فى الـ popup،
    // بضغطة realClick بسيطة (مش activate) — activate كان بيتسلّق لعناصر ADF ويشغّل _skipToContent اللى بيكراش.
    const excel = await waitFor(() => bestText(document,'[role="menuitem"],a,div,span,td,li','تحميل اكسل') || bestText(document,'[role="menuitem"],a,div,span,td,li','اكسل') || bestText(document,'[role="menuitem"],a,div,span,td,li','excel'), { label:'Download Excel item', timeout:15000 });
    log('excel item ->', excel.tagName, norm(excel.textContent).slice(0,24)); realClick(excel);
    try {
      const exportBtn = await waitFor(() => byText(document,'a,button,input[type=submit]','Export',{exact:false}) || byText(document,'a,button,input[type=submit]','تصدير',{exact:false}), { label:'Export popup button', timeout:12000 });
      log('WFM export — href:', (exportBtn.href||'').slice(0,60), '| onclick:', (exportBtn.getAttribute('onclick')||'—').slice(0,90));
      captureGetHref(exportBtn, 'wfm_orders.xls', '/api/maintenance-orders/import');
      armCapture('wfm_orders.xls', '/api/maintenance-orders/import', 'WFM');
      realClick(exportBtn); log('WFM Export clicked. DONE.');
    } catch (e) { log('WFM: Export popup not found.'); }
    // مفيش chaining لـ OSS: Service-Flow بيفتحه بالتوازى مع FCC/WFM.
  }

  /* =======================================================================
     OSS  (Abnormal WO / متعذرات OM)
     ===================================================================== */
  function getAbnormalDoc(){for(let i=0;i<window.frames.length;i++){try{const d=window.frames[i].document;if(/exception_wotask\.jsp/i.test(d.URL))return{win:window.frames[i],doc:d};for(let j=0;j<window.frames[i].frames.length;j++){try{const dd=window.frames[i].frames[j].document;if(/exception_wotask\.jsp/i.test(dd.URL))return{win:window.frames[i].frames[j],doc:dd};}catch(e){}}}catch(e){}}return null;}
  function collectDocs(){const docs=[document];for(let i=0;i<window.frames.length;i++){try{if(window.frames[i].document)docs.push(window.frames[i].document);}catch(e){}try{for(let j=0;j<window.frames[i].frames.length;j++){try{if(window.frames[i].frames[j].document)docs.push(window.frames[i].frames[j].document);}catch(e){}}}catch(e){}}return docs;}
  function findAbnormalCandidates(){const SEL='a,span,div,li,td,p,cite,button,dd,b,font',out=[];for(const doc of collectDocs()){let els;try{els=Array.from(doc.querySelectorAll(SEL));}catch(e){continue;}for(const el of els){const txt=norm(el.textContent).toLowerCase();if(txt.includes('abnormal wo')&&txt.length<=24)out.push(el);}}out.sort((a,b)=>norm(a.textContent).length-norm(b.textContent).length);return out.slice(0,4);}
  async function openAbnormalTab(){for(let attempt=1;attempt<=6;attempt++){if(getAbnormalDoc())return true;const cands=findAbnormalCandidates();log('Abnormal WO candidates:',cands.length,'(attempt '+attempt+')');for(const el of cands){const opened=await activate(el,()=>!!getAbnormalDoc());if(opened||getAbnormalDoc()){log('Abnormal WO tab opened');return true;}}await sleep(1200);}return false;}
  const ASSIUT_RE=/assiut|asyut|أسيوط|اسيوط/i;
  function findGovOption(sel){if(!sel||!sel.options)return null;return Array.from(sel.options).find(o=>ASSIUT_RE.test((o.value||'').trim())||ASSIUT_RE.test((o.textContent||'').trim()));}
  function openSelect(sel){const win=(sel.ownerDocument&&sel.ownerDocument.defaultView)||window;try{sel.scrollIntoView({block:'center'});}catch(e){}try{sel.focus();}catch(e){}['mouseover','mousedown','mouseup','click'].forEach(t=>{try{sel.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:win}));}catch(e){}});try{sel.dispatchEvent(new Event('focus',{bubbles:true}));}catch(e){}try{sel.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowDown',keyCode:40,which:40}));}catch(e){}}
  function selectForLabel(lab){const tries=[];if(lab.parentElement)tries.push(lab.parentElement);let n=lab.nextElementSibling,c=0;while(n&&c<4){tries.push(n);n=n.nextElementSibling;c++;}const cell=lab.parentElement;if(cell){let m=cell.nextElementSibling,k=0;while(m&&k<3){tries.push(m);m=m.nextElementSibling;k++;}}for(const el of tries){if(el.tagName==='SELECT')return el;const s=el.querySelector&&el.querySelector('select');if(s)return s;}return null;}
  function findGovSelect(doc){let s=doc.getElementById('governorateQ');if(s&&s.tagName==='SELECT')return s;const labs=Array.from(doc.querySelectorAll('label,span,div,td,p,th,dt,b,font')).filter(el=>el.children.length===0&&/^governorate$/i.test(norm(el.textContent)));for(const lab of labs){const sel=selectForLabel(lab);if(sel)return sel;}return Array.from(doc.querySelectorAll('select')).find(sel=>findGovOption(sel))||null;}

  // ModuleName mapping من مصدر btn_download (taskModuleName → ModuleName)
  const OSS_MODMAP = {
    ordertask_query1: 'Order Query1', ordertask_query2: 'Order Query2',
    ordertask_monitor1: 'Order Monitor1', ordertask_monitor2: 'Order Monitor2',
    exception_wotask: 'Abnormal Query',
  };

  function captureOSS(downloadAnchor, taskWin, ossOrigin) {
    const onclick = downloadAnchor.getAttribute('onclick') || '';
    log('OSS anchor — onclick:', onclick.slice(0, 220));
    // btn_download → formfortoken(contextPath+"/service/eoms/ordermgt/downloadOrderExcel.ilf?filePath="+filePath+"&ModuleName="+ModuleName)
    // أى أنه يبنى form ويضيف CSRF token ثم submit. نلتقط ذلك الـ submit من نافذة الـ task.
    const mArgs = onclick.match(/btn_download\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/i);
    const filePath = mArgs ? mArgs[1] : null;
    const taskModule = mArgs ? mArgs[2] : 'exception_wotask';
    const moduleName = OSS_MODMAP[taskModule] || 'Abnormal Query';
    const filename = filePath ? filePath.split('/').pop() : ('oss_om_' + Date.now() + '.xlsx');
    if (!filePath) { log('OSS: لا filePath في onclick'); return; }
    log('OSS filePath:', filePath, '| module:', moduleName);

    let done = false;
    function gmReq(opts) {
      return new Promise((resolve) => {
        GM_xmlhttpRequest(Object.assign({
          responseType: 'arraybuffer', timeout: 60000,
          onload: (r) => resolve({ status: r.status, buf: r.response || new ArrayBuffer(0) }),
          onerror: () => resolve({ status: 0, buf: new ArrayBuffer(0) }),
          ontimeout: () => resolve({ status: 0, buf: new ArrayBuffer(0) }),
        }, opts));
      });
    }
    function handle(status, buf, via) {
      if (done) return false;
      const u8 = new Uint8Array(buf);
      log('  ['+via+'] status:', status, '| bytes:', buf.byteLength, '| magic:', (u8[0]||0).toString(16).padStart(2,'0')+(u8[1]||0).toString(16).padStart(2,'0'));
      if (status === 200 && buf.byteLength > 100 && looksExcel(u8)) {
        done = true; log('✅ OSS file via', via);
        uploadToSF(new Blob([buf]), filename, '/api/ftth-orders/import'); return true;
      }
      return false;
    }

    // يُسلسل أى form (action + الحقول بما فيها التوكن) ثم يعيد إرساله عبر GM_xmlhttpRequest
    // (يحمل الكوكيز) — فنلتقط نفس الملف الذى يحمّله الـ form الأصلى ونرفعه للموقع.
    let formHandled = false;
    function replayForm(formEl, via) {
      if (formHandled || done) return false;
      let action = '', method = 'GET', body = '';
      try {
        action = formEl.action || (formEl.getAttribute && formEl.getAttribute('action')) || '';
        method = (formEl.method || 'GET').toUpperCase();
        const params = new URLSearchParams();
        Array.from(formEl.querySelectorAll('input,select,textarea')).forEach(inp => {
          if (!inp.name || inp.type === 'file') return;
          if ((inp.type === 'checkbox' || inp.type === 'radio') && !inp.checked) return;
          params.append(inp.name, inp.value || '');
        });
        body = params.toString();
      } catch(e) { log('OSS serialize err:', e.message); }
      // لا نلتقط إلا فورم التحميل (downloadOrderExcel.ilf)
      if (!/downloadOrderExcel|\.ilf/i.test(String(action))) { log('OSS skip non-download form:', String(action).slice(0,60)); return false; }
      formHandled = true;
      log('📸 OSS form ['+via+'] →', String(action).slice(0, 90), '|', method, '| fields:', body ? body.split('&').length : 0);
      (async () => {
        const opts = method === 'POST'
          ? { method: 'POST', url: action, data: body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
          : { method: 'GET', url: action + (body ? (action.indexOf('?') >= 0 ? '&' : '?') + body : '') };
        const { status, buf } = await gmReq(opts);
        if (handle(status, buf, via)) saveToDisk(buf, filename);
        else formHandled = false; // افسح المجال لمسار آخر لو فشل
      })();
      return true;
    }

    // (1) hook native form.submit() فى نافذة الـ task — يلتقط الـ submit المبرمَج
    try {
      const proto = taskWin.HTMLFormElement.prototype;
      const orig = proto.submit;
      const restore = () => { try { proto.submit = orig; } catch(e){} };
      setTimeout(restore, 90000);
      proto.submit = function () {
        const handled = replayForm(this, 'submit-hook');
        if (handled) return; // نمنع الـ submit الأصلى — نضمن التحميل عبر saveToDisk
        return orig.apply(this, arguments);
      };
      log('OSS native submit hook installed');
    } catch(e) { log('OSS submit-hook install err:', e.message); }

    // (2) capture-phase submit EVENT — يلتقط jQuery .submit()/زر submit
    // (الـ event لا يُطلَق عند native .submit() والعكس صحيح، فنغطّى الحالتين).
    try {
      const onSubmit = (e) => {
        const f = e.target;
        if (f && f.tagName === 'FORM' && replayForm(f, 'submit-event')) {
          e.preventDefault(); e.stopImmediatePropagation();
        }
      };
      taskWin.document.addEventListener('submit', onSubmit, true);
      setTimeout(() => { try { taskWin.document.removeEventListener('submit', onSubmit, true); } catch(e){} }, 90000);
      log('OSS submit-event listener installed');
    } catch(e) { log('OSS submit-event install err:', e.message); }

    // (3) fallback GET مباشر على الـ endpoint الموثّق (لو الـ hook لم يُطلَق)
    (async () => {
      await sleep(5000);
      if (done) return;
      const url = ossOrigin + '/om/service/eoms/ordermgt/downloadOrderExcel.ilf?filePath='
        + encodeURIComponent(filePath) + '&ModuleName=' + encodeURIComponent(moduleName);
      log('OSS fallback GET:', '/om/service/eoms/ordermgt/downloadOrderExcel.ilf');
      const { status, buf } = await gmReq({ method: 'GET', url });
      if (!handle(status, buf, 'fallback-GET') && !done)
        log('❌ OSS لم يُلتقَط — راجع سطر "📸 OSS form" أو الـ fallback أعلاه.');
    })();
  }

  async function runOSS() {
    log('OSS flow');
    if (/\/cas\//i.test(location.href)) { await doLogin(); return; }
    const opened = await openAbnormalTab(); if (!opened) log('Auto-open failed. Click "Abnormal WO" manually.');
    const frame = await waitFor(getAbnormalDoc, { label:'OSS Abnormal frame', timeout:120000, interval:800 });
    const d = frame.doc; await sleep(1500); log('Abnormal frame found');
    const moreSearch = await waitFor(() => d.getElementById('moresearch'), { label:'OSS More Search', timeout:20000 });
    realClick(moreSearch); await sleep(1200); log('More Search expanded');
    let govSel=null;
    try { await waitFor(()=>{govSel=findGovSelect(d);return!!govSel;},{label:'OSS Governorate select',timeout:30000,interval:600}); } catch(e){log('Governorate not found:',Array.from(d.querySelectorAll('select')).map(s=>'#'+(s.id||'?')).join(' '));throw e;}
    log('gov select #'+(govSel.id||'?')+' located');
    let govOpt=null,loggedOpts=false,prompted=false;const gStart=Date.now();
    while(Date.now()-gStart<25000){openSelect(govSel);govOpt=findGovOption(govSel);if(govOpt)break;const nOpts=govSel.options?govSel.options.length:0;if(!loggedOpts&&nOpts>0){loggedOpts=true;log('gov opts:',Array.from(govSel.options).slice(0,14).map(o=>(o.value||'')+'="'+norm(o.textContent)+'"').join(' | ').slice(0,300));}if(!prompted&&Date.now()-gStart>12000){prompted=true;try{govSel.scrollIntoView({block:'center'});}catch(e){}log('(optional) click Governorate dropdown; else Assiut injected.');}await sleep(700);}
    if(!govOpt){const o=d.createElement('option');o.value='Assiut';o.textContent='Assiut';o.selected=true;govSel.appendChild(o);govOpt=o;log('Injected "Assiut".');}
    govSel.value=govOpt.value;govSel.dispatchEvent(new Event('change',{bubbles:true}));if(frame.win.jQuery){try{frame.win.jQuery(govSel).trigger('change');}catch(e){}}try{govSel.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape',keyCode:27}));}catch(e){}try{govSel.blur();}catch(e){}try{if(frame.win.layui&&frame.win.layui.form)frame.win.layui.form.render('select');}catch(e){}try{let ls=govSel.nextElementSibling;if(!(ls&&ls.classList&&ls.classList.contains('layui-form-select'))){const wrap=govSel.closest('.layui-form-item,.layui-input-inline,.layui-form-select')||govSel.parentElement;ls=(wrap&&wrap.querySelector('.layui-form-select'))||null;}if(ls){realClick(ls.querySelector('.layui-select-title')||ls);await sleep(300);const dd=Array.from(ls.querySelectorAll('dl dd')).find(x=>ASSIUT_RE.test(norm(x.textContent)));if(dd)realClick(dd);}}catch(e){}
    log('Governorate set ->',govOpt.value,'/',norm(govOpt.textContent));
    realClick(d.getElementById('search')); log('Search clicked, waiting ~10s'); await sleep(10000);
    realClick(d.getElementById('btn_export'));
    const taskInput=await waitFor(()=>d.querySelector('input.layui-layer-input'),{label:'OSS task-name input'});
    taskInput.focus();taskInput.value='claude';taskInput.dispatchEvent(new Event('input',{bubbles:true}));realClick(d.querySelector('a.layui-layer-btn0'));log('export task "claude" submitted');await sleep(1500);
    realClick(d.getElementById('btn_task'));
    function getTaskDoc(){try{for(let i=0;i<frame.win.frames.length;i++){const td=frame.win.frames[i].document;if(/toTask\.ilf/i.test(td.URL))return{win:frame.win.frames[i],doc:td};}}catch(e){}return null;}
    const task=await waitFor(getTaskDoc,{label:'OSS Task window',timeout:20000});
    await sleep(20000);
    const downloadAnchor=await waitFor(()=>{const rb=task.doc.getElementById('btn_refresh');if(rb)realClick(rb);const rows=Array.from(task.doc.querySelectorAll('table tr'));for(const tr of rows){const tds=tr.querySelectorAll('td');if(tds.length>=6){const name=norm(tds[2].textContent),status=norm(tds[4].textContent);if(name==='claude'&&/Completed/i.test(status)){const a=tds[5].querySelector('a[onclick]');if(a)return a;}}}return null;},{label:'OSS completed claude row',timeout:300000,interval:10000});
    log('OSS downloading:',norm(downloadAnchor.textContent));
    captureOSS(downloadAnchor, task.win, 'https://oss.te.eg:15201');
    realClick(downloadAnchor); log('OSS download triggered. DONE.');
  }

  /* =======================================================================
     SubInfo — جلب اسم/عنوان العميل + بيانات فنية من FCC Complains (مدموج)
     يشتغل: (1) بعد التصدير على تاب fcc_daily، أو (2) لوحده على تاب sf_subinfo_auto/one
     ===================================================================== */
  const DZS_TOKEN = 'sf-dzs-138-ingest-2026';   // = DZS_INGEST_TOKEN فى السيرفر
  const SI_BATCH  = 300;                        // عدد الأرقام اللى يراجعها كل تشغيل (الباقى يكمّل الدورة الجاية)
  function arabicOnly(s) { const m = (s || '').match(/[؀-ۿ][؀-ۿ0-9\s\/\-.,()]*/g); return m ? m.map(x => x.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\s*,\s*/g, '، ').trim() : ''; }
  const cleanLbl = (s) => norm(s).replace(/[*:：]/g, '').trim().toLowerCase();
  function findInputByLabel(labelText) {
    const want = cleanLbl(labelText);
    const labs = Array.from(document.querySelectorAll('label,span,td,div,th,dt')).filter(e => e.children.length === 0 && cleanLbl(e.textContent) === want);
    for (const lab of labs) {
      const forId = lab.getAttribute && lab.getAttribute('for');
      if (forId) { const el = document.getElementById(forId); if (el && el.tagName === 'INPUT') return el; }
      let scope = lab.parentElement;
      for (let i = 0; i < 5 && scope; i++) { const inp = scope.querySelector('input[type=text], input:not([type]):not([type=hidden])'); if (inp) return inp; scope = scope.parentElement; }
      let n = lab.nextElementSibling, c = 0;
      while (n && c < 5) { if (n.tagName === 'INPUT') return n; const inp = n.querySelector && n.querySelector('input[type=text],input:not([type])'); if (inp) return inp; n = n.nextElementSibling; c++; }
    }
    return null;
  }
  function labelValue(labelText) {
    const want = cleanLbl(labelText);
    const labs = Array.from(document.querySelectorAll('label,span,td,div,th,dt,b,font,p')).filter(e => e.children.length === 0 && cleanLbl(e.textContent) === want);
    for (const lab of labs) {
      const tries = [];
      if (lab.nextElementSibling) tries.push(lab.nextElementSibling);
      const cell = lab.parentElement;
      if (cell && cell.nextElementSibling) tries.push(cell.nextElementSibling);
      let n = lab.nextElementSibling, c = 0;
      while (n && c < 3) { tries.push(n); n = n.nextElementSibling; c++; }
      for (const t of tries) { const v = norm(t.textContent); if (v && cleanLbl(v) !== want) return v; }
    }
    return '';
  }
  function siGm(opts) { return new Promise((resolve) => { GM_xmlhttpRequest(Object.assign({ timeout: 30000, onload: r => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: r.responseText || '' }), onerror: () => resolve({ ok: false, status: 0, text: '' }), ontimeout: () => resolve({ ok: false, status: 0, text: '' }) }, opts)); }); }
  async function siGetPending() { const r = await siGm({ method: 'GET', url: SF_URL + '/api/line-subscriber-info/pending?limit=' + SI_BATCH, headers: { 'X-DZS-Token': DZS_TOKEN } }); if (!r.ok) { log('❌ SubInfo: فشل جلب القائمة', r.status); return []; } try { return JSON.parse(r.text).phones || []; } catch (e) { return []; } }
  async function siIngest(phoneNumber, data) { const r = await siGm({ method: 'POST', url: SF_URL + '/api/line-subscriber-info/ingest', headers: { 'Content-Type': 'application/json', 'X-DZS-Token': DZS_TOKEN }, data: JSON.stringify(Object.assign({ phoneNumber }, data)) }); if (!r.ok) log('❌ SubInfo: فشل الرفع', phoneNumber, r.status); return r.ok; }
  const siHasSearch = () => !!(findInputByLabel('CityCode') && findInputByLabel('TelNo'));
  async function siNavigateToComplains() {
    if (siHasSearch()) return true;
    let tile;
    try { tile = await waitFor(() => byText(document, 'a,button,span,td,div,h1,h2,h3,h4,p', 'Complains', { exact: true }) || byText(document, 'a,button,span,td,div,h1,h2,h3,h4,p', 'Complain', { exact: false }), { label: 'Complains tile', timeout: 20000 }); }
    catch (e) { log('❌ SubInfo: بلاطة Complains مش لاقيها'); return false; }
    log('SubInfo tile ->', tile.tagName, norm(tile.textContent).slice(0, 20));
    // بلاطة FCC عنصر ADF — نستخدم activate (بيتسلّق لعنصر الأمر ويضغط بأكثر من طريقة) زى بلاطة Ticket Queue
    const opened = await activate(tile, () => siHasSearch());
    if (opened || siHasSearch()) return true;
    try { await waitFor(siHasSearch, { label: 'Complains search', timeout: 15000 }); return true; } catch (e) { log('❌ SubInfo: فورم البحث مظهرش'); return false; }
  }
  async function siProcessOne(phone) {
    const short = String(phone).replace(/^0*88/, '').replace(/\D/g, '');
    const cityEl = findInputByLabel('CityCode'), telEl = findInputByLabel('TelNo');
    if (!cityEl || !telEl) { log('⚠️ SubInfo: مالقيتش خانات البحث'); return false; }
    setField(cityEl, '88'); setField(telEl, short); await sleep(250);
    const searchBtn = byText(document, 'a,button,input[type=submit],input[type=button],span', 'Search', { exact: true }) || byText(document, 'a,button,input[type=submit]', 'Search', { exact: false });
    if (!searchBtn) { log('⚠️ SubInfo: زر Search مش موجود'); return false; }
    realClick(searchBtn); await sleep(2600);
    const bodyTxt = norm(document.body.textContent).toLowerCase();
    const subName = labelValue('SubName');
    const subAdd = arabicOnly(labelValue('SubAdd'));
    const workOrdDate = labelValue('WorkOrdDate');
    const workOrdNo = labelValue('WorkOrdNo');
    const splitSlash = (s) => (s || '').split('/').map((x) => x.trim());
    const cabinBT = splitSlash(labelValue('CabinetNo/B/T'));   // [الكابينة, Fiber Block, Cabinet In]
    const dpNoT = splitSlash(labelValue('DPNo/T'));            // [البكس, DP Terminal]
    const secBlockT = splitSlash(labelValue('SecBlockNo/T'));  // [Sec Block, Cabinet Out]
    const tech = { central: arabicOnly(labelValue('ExchCode')) || null, cabinNumber: cabinBT[0] || null, fiberBlock: cabinBT[1] || null, cabinetIn: cabinBT[2] || null, boxNumber: dpNoT[0] || null, dpTerminal: dpNoT[1] || null, secBlock: secBlockT[0] || null, cabinetOut: secBlockT[1] || null, primaryBlock: labelValue('SBLOCK_NO') || null, portNo: labelValue('Port') || null, iduNo: labelValue('IduNo') || null, oduNo: labelValue('OduNo') || null, fiberOut: labelValue('FiberOut') || null, lineType: labelValue('LineTypeName') || null };
    if (!subName && !subAdd && !tech.cabinNumber && /no rows found/.test(bodyTxt)) log('•', short, '→ لا يوجد بيانات');
    else log('•', short, '→', subName ? ('اسم: ' + subName.slice(0, 16)) : 'بدون اسم', '| كابينة:', tech.cabinNumber || '-', 'بكس:', tech.boxNumber || '-', 'Port:', tech.portNo || '-');
    await siIngest(phone, Object.assign({ subName, subAdd, workOrdDate, workOrdNo }, tech));
    return true;
  }
  // مراجعة كل الأرقام المطلوبة (ليها بورتات وملهاش بيانات فنية) — closeAfter: يقفل التاب فى الآخر
  async function runSubInfoAll(closeAfter) {
    log('🔎 SubInfo: جلب الأرقام المطلوبة (بورتات بدون بيانات فنية)...');
    const phones = await siGetPending();
    log('SubInfo عدد الأرقام:', phones.length);
    if (phones.length && await siNavigateToComplains()) {
      let done = 0;
      for (const phone of phones) { try { await siProcessOne(phone); } catch (e) { log('SubInfo خطأ', phone, e.message); } done++; if (done % 25 === 0) log('SubInfo تقدّم:', done + '/' + phones.length); await sleep(900); }
      log('✅ SubInfo خلص:', done);
    } else if (!phones.length) log('✅ SubInfo: مفيش أرقام مطلوبة.');
    if (closeAfter) setTimeout(() => { try { window.close(); } catch (e) {} }, 8000);
  }
  async function runSubInfoOne(phone) {
    log('🔎 SubInfo رقم واحد:', phone);
    if (!(await siNavigateToComplains())) return;
    try { await siProcessOne(phone); } catch (e) { log('SubInfo خطأ:', e.message); }
    log('✅ SubInfo خلص الرقم — إغلاق.'); setTimeout(() => { try { window.close(); } catch (e) {} }, 5000);
  }

  /* ---------- router ---------- */
  async function main() {
    let isTop=true; try{isTop=(window.top===window.self);}catch(e){isTop=false;}
    if(!isTop&&!document.querySelector('input[type=password]'))return;
    // وضع مراجعة الاسم/العنوان لوحده (زر المراجعة اليدوى) — على FCC عبر window.name
    let WN=''; try{WN=window.name||'';}catch(e){}
    // العلامة الحقيقية من sessionStorage (اتثبّتت عند document-start) لأن FCC بيمسح window.name بعد الدخول
    let SImode=''; try{SImode=sessionStorage.getItem('sf_si_mode')||'';}catch(e){}
    const marker = SImode || WN;
    const SI_AUTO = marker === 'sf_subinfo_auto';
    const SI_ONE  = marker.indexOf('sf_subinfo_one:')===0 ? marker.slice('sf_subinfo_one:'.length) : '';
    if (SI_AUTO || SI_ONE) {
      log('SubInfo mode', SI_ONE ? ('[ONE:'+SI_ONE+']') : '[AUTO]');
      if (/Login\.jsf/i.test(location.href) || document.querySelector('input[type=password]')) { await doLogin(); return; }
      try { if (SI_ONE) await runSubInfoOne(SI_ONE); else await runSubInfoAll(true); } catch(e){ log('SubInfo ERROR:', e.message); }
      return;
    }
    log('page:',location.host,location.pathname,isTop?'[top]':'[frame]');
    // لو ضمن تدفّق "تحديث الملفات اليومية" (من زر Service-Flow) جدّد العلامة الزمنية — عشان التابات
    // المتسلسلة (WFM/OSS) تقفل نفسها بعد الرفع كمان. الفتح اليدوى العادى مش بيفعّل ده.
    if(isDailyFlow()) markDailyFlow();
    if(looksBroken()){const home=LOGIN_URL[location.host]||LOGIN_URL['fcc.te.eg'];let last=0;try{last=GM_getValue('recover_at',0);}catch(e){}if(Date.now()-last>8000){try{GM_setValue('recover_at',Date.now());}catch(e){}log('500 detected, restarting...');location.href=home;}else{log('500; just redirected.');}return;}
    const host=location.host;
    try {
      if (host.startsWith('fcc.te.eg')) {
        // بعد التصدير رجعنا لـ Home بعلامة "review" → ندخل طور المراجعة بدل ما نعيد التصدير
        let phase=''; try{phase=sessionStorage.getItem('sf_fcc_phase')||'';}catch(e){}
        if (phase === 'review') {
          // لو رجعنا لصفحة دخول (نادراً) سجّل دخول وسيب العلامة — بعد الريلود نكمّل المراجعة
          if (/Login\.jsf/i.test(location.href) || document.querySelector('input[type=password]')) { log('review phase: login'); await doLogin(); return; }
          try{sessionStorage.removeItem('sf_fcc_phase');}catch(e){}
          log('SubInfo phase (بعد التصدير)'); await runSubInfoAll(true);
        }
        else await runFCC();
      }
      else if (host.startsWith('wfm.te.eg')) await runWFM();
      else if (host.startsWith('oss.te.eg')) await runOSS();
    } catch(e){log('ERROR:',e.message||String(e));console.error('[TE] error:',e);}
  }

  log('TE FCC + WFM + OSS + SubInfo v3.0.4 loaded on', location.host);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(main, 1500));
  else setTimeout(main, 1500);
})();
