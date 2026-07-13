// ==UserScript==
// @name         TE FCC — جلب اسم وعنوان العميل (Subscriber Info)
// @namespace    te.eg.subinfo
// @version      1.3.1
// @description  v1.3.1: طريقة دخول FCC مطابقة تماماً لسكربت التصدير المجرَّب (اكتشاف الزر + إعادة المحاولة). v1.3.0: قفل دخول FCC مشترك يمنع الدخول المتزامن مع سكربت التصدير (LoginException). v1.2.0: يجلب كمان البيانات الفنية (السنترال/الكابينة/البكس/DP/Port/IDU/ODU/البلوكات) من Fiber Link Data. v1.1.0: وضع "رقم واحد" (window.name=sf_subinfo_one:رقم) لزر المراجعة فى بحث برقم التليفون. يفتح FCC → Complains، يبحث بـ 88 + رقم التليفون لكل رقم من البورتات (اللى ملوش اسم/عنوان بعد)، يقرأ SubName / SubAdd (عربى فقط) / WorkOrdDate / WorkOrdNo ويرفعها لـ Service-Flow.
// @match        https://fcc.te.eg/TroubleTicket/faces/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      service-flow-menoskar42.replit.app
// @connect      replit.app
// @connect      fcc.te.eg
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  /* ===== CONFIG ===== */
  const SF_URL   = 'https://service-flow-menoskar42.replit.app';
  const DZS_TOKEN = 'sf-dzs-138-ingest-2026';        // = DZS_INGEST_TOKEN فى السيرفر
  const CREDS    = { user: 'mena.haleem', pass: 'Mon_oskar364' };
  const AUTO_NAME = 'sf_subinfo_auto';               // window.name اللى بيشغّل الجلب تلقائياً
  const BETWEEN_MS = 900;                             // مهلة بين كل رقم والتانى

  /* ===== on-screen logger ===== */
  const log = (() => {
    let box;
    return (...a) => {
      try { console.log('%c[SubInfo]', 'color:#a0f', ...a); } catch (e) {}
      try {
        if (!box) {
          if (!document.body && !document.documentElement) return;
          box = document.createElement('div');
          box.style.cssText = 'position:fixed;z-index:2147483647;bottom:8px;right:8px;max-width:460px;max-height:52vh;overflow:auto;background:#12081f;color:#e9c6ff;font:12px/1.45 monospace;padding:8px 10px;border:1px solid #a0f;border-radius:8px;opacity:.96;white-space:pre-wrap;direction:ltr;text-align:left';
          (document.body || document.documentElement).appendChild(box);
        }
        const line = document.createElement('div');
        line.textContent = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
        box.appendChild(line); box.scrollTop = box.scrollHeight;
      } catch (e) {}
    };
  })();

  /* ===== helpers ===== */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm  = s => (s || '').replace(/\s+/g, ' ').trim();
  async function waitFor(pred, { timeout = 25000, interval = 350, label = '' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) { let v; try { v = pred(); } catch (e) { v = null; } if (v) return v; await sleep(interval); }
    throw new Error('waitFor timeout: ' + label);
  }
  function fire(el, type) { try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); } catch (e) {} }
  function realClick(el) { if (!el) return false; try { el.scrollIntoView({ block: 'center' }); } catch (e) {} try { ['mousedown','mouseup','click'].forEach(t => fire(el, t)); } catch (e) { try { el.click(); } catch (e2) {} } return true; }
  function setField(el, value) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
    try { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); } catch (e) { el.value = value; }
    ['input','change','blur','keyup'].forEach(t => { try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {} });
  }
  function byText(sel, text, exact) {
    const t = norm(text).toLowerCase();
    return Array.from(document.querySelectorAll(sel)).find(el => {
      const c = norm(el.textContent || el.value || '').toLowerCase();
      return exact ? c === t : c.includes(t);
    });
  }
  // نص عربى فقط من سلسلة مختلطة (نلتقط تتابعات الحروف العربية ونتجاهل الإنجليزى)
  function arabicOnly(s) {
    const m = (s || '').match(/[؀-ۿ][؀-ۿ0-9\s\/\-.,()]*/g);
    return m ? m.map(x => x.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\s*,\s*/g, '، ').trim() : '';
  }

  /* ===== SF calls (GM_xmlhttpRequest) ===== */
  function gm(opts) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest(Object.assign({ timeout: 30000,
        onload: r => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: r.responseText || '' }),
        onerror: () => resolve({ ok: false, status: 0, text: '' }),
        ontimeout: () => resolve({ ok: false, status: 0, text: '' }),
      }, opts));
    });
  }
  async function getPending() {
    const r = await gm({ method: 'GET', url: SF_URL + '/api/line-subscriber-info/pending?limit=20000', headers: { 'X-DZS-Token': DZS_TOKEN } });
    if (!r.ok) { log('❌ فشل جلب القائمة — status:', r.status); return []; }
    try { return JSON.parse(r.text).phones || []; } catch (e) { log('❌ رد غير صالح للقائمة'); return []; }
  }
  async function ingest(phoneNumber, data) {
    const r = await gm({ method: 'POST', url: SF_URL + '/api/line-subscriber-info/ingest',
      headers: { 'Content-Type': 'application/json', 'X-DZS-Token': DZS_TOKEN },
      data: JSON.stringify(Object.assign({ phoneNumber }, data)) });
    if (!r.ok) log('❌ فشل الرفع لـ', phoneNumber, '— status:', r.status);
    return r.ok;
  }

  /* ===== FCC login (قفل مشترك يمنع الدخول المتزامن من تابين — يمنع LoginException) ===== */
  async function acquireFccLock() {
    const KEY = 'sf_fcc_login_lock';
    for (let i = 0; i < 30; i++) {
      let held = 0; try { held = Number(localStorage.getItem(KEY) || 0); } catch (e) {}
      if (!held || Date.now() - held > 20000) { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} return; }
      log('⏳ انتظار قفل دخول FCC (تاب تانى بيسجّل دخول)...'); await sleep(1500);
    }
  }
  function releaseFccLock() { setTimeout(() => { try { localStorage.removeItem('sf_fcc_login_lock'); } catch (e) {} }, 9000); }
  // نفس منطق دخول FCC المجرَّب فى سكربت التصدير (اكتشاف الزر + إعادة المحاولة) — عشان يبقى متطابق تماماً
  async function doLogin() {
    await acquireFccLock(); releaseFccLock();
    const c = CREDS;
    if (c && c.pass) {
      const pw = await waitFor(() => document.querySelector('input[type=password]'), { timeout: 15000, interval: 300, label: 'password' }).catch(() => null);
      if (pw) {
        const scope = pw.closest('form') || document;
        const userEl = scope.querySelector('input[type=text]') || document.querySelector('input[type=text]');
        setField(userEl, c.user); setField(pw, c.pass); log('filled credentials:', c.user); await sleep(400);
      }
    }
    const TERMS = ['login','log in','log on','logon','sign in','signin','تسجيل الدخول','تسجيل دخول','دخول','الدخول'];
    const labelOf = el => norm(el.value)||norm(el.textContent)||norm(el.alt)||norm(el.getAttribute('aria-label'))||norm(el.title);
    const isLoginBtn = el => { const l = labelOf(el).toLowerCase(); return l.length > 0 && l.length <= 24 && TERMS.some(t => l.includes(t)); };
    const rank = el => { const tag = el.tagName.toLowerCase(), type = (el.type||'').toLowerCase(); if (tag==='input'&&(type==='submit'||type==='image')) return 0; if (tag==='button') return 1; if (tag==='a'&&el.getAttribute('onclick')) return 2; if (tag==='input'&&type==='button') return 3; return 4; };
    let cands = [];
    try { await waitFor(() => { cands = Array.from(document.querySelectorAll('input[type=submit],button,input[type=image],input[type=button],a[onclick],a[role=button],a')).filter(isLoginBtn).sort((a,b)=>rank(a)-rank(b)); return cands.length; }, { timeout: 20000, interval: 400, label: 'login candidates' }); } catch (e) {}
    for (const btn of cands) { try { btn.click(); } catch (e) {} await sleep(1600); if (!onLogin()) { log('LOGIN OK'); return; } realClick(btn); await sleep(1800); if (!onLogin()) { log('LOGIN OK'); return; } }
    log('STILL on login.');
  }

  /* ===== Complains: navigate + search + scrape ===== */
  const onLogin = () => /Login\.jsf/i.test(location.href) || !!document.querySelector('input[type=password]');
  const hasComplainsSearch = () => !!(findInputByLabel('CityCode') && findInputByLabel('TelNo'));

  function findInputByLabel(labelText) {
    const want = norm(labelText).replace('*', '').toLowerCase();
    const labs = Array.from(document.querySelectorAll('label,span,td,div,th,dt')).filter(e =>
      e.children.length === 0 && norm(e.textContent).replace('*', '').toLowerCase() === want);
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

  // قيمة أمام label معيّن (SubName / WorkOrdDate ...) — نلاقى عنصر الليبل الصغير ونجيب أقرب قيمة نصية بعده
  const cleanLbl = (s) => norm(s).replace(/[*:：]/g, '').trim().toLowerCase();
  function labelValue(labelText) {
    const want = cleanLbl(labelText);
    const labs = Array.from(document.querySelectorAll('label,span,td,div,th,dt,b,font,p'))
      .filter(e => e.children.length === 0 && cleanLbl(e.textContent) === want);
    for (const lab of labs) {
      const tries = [];
      if (lab.nextElementSibling) tries.push(lab.nextElementSibling);
      const cell = lab.parentElement;
      if (cell) { if (cell.nextElementSibling) tries.push(cell.nextElementSibling); }
      // كمان عناصر بعد الخلية على مستوى الصف
      let n = lab.nextElementSibling, c = 0;
      while (n && c < 3) { tries.push(n); n = n.nextElementSibling; c++; }
      for (const t of tries) { const v = norm(t.textContent); if (v && cleanLbl(v) !== want) return v; }
    }
    return '';
  }

  async function navigateToComplains() {
    if (hasComplainsSearch()) return true;
    // من صفحة Home: بلاطة "Complains"
    let tile;
    try { tile = await waitFor(() => byText('a,button,span,td,div,h1,h2,h3,h4,p', 'Complains', true) || byText('a,button,span,td,div,h1,h2,h3,h4,p', 'Complain', false), { label: 'Complains tile', timeout: 20000 }); }
    catch (e) { log('❌ بلاطة Complains مش لاقيها:', e.message); return false; }
    log('tile ->', tile.tagName, norm(tile.textContent).slice(0, 20));
    realClick(tile); const a = tile.closest('a'); if (a && a !== tile) realClick(a);
    try { await waitFor(hasComplainsSearch, { label: 'Complains search form', timeout: 20000 }); return true; }
    catch (e) { log('❌ فورم البحث مظهرش:', e.message); return false; }
  }

  async function processOne(phone) {
    const short = String(phone).replace(/^0*88/, '').replace(/\D/g, '');   // شيل بادئة 88 لو موجودة
    const cityEl = findInputByLabel('CityCode'), telEl = findInputByLabel('TelNo');
    if (!cityEl || !telEl) { log('⚠️ مالقيتش خانات البحث'); return false; }
    setField(cityEl, '88'); setField(telEl, short); await sleep(250);
    const searchBtn = byText('a,button,input[type=submit],input[type=button],span', 'Search', true) || byText('a,button,input[type=submit]', 'Search', false);
    if (!searchBtn) { log('⚠️ زر Search مش موجود'); return false; }
    realClick(searchBtn); await sleep(2600);

    // نتيجة؟ لو "No rows found" نسجّل فاضى عشان مايتعادش جلبه.
    const bodyTxt = norm(document.body.textContent).toLowerCase();
    const subName = labelValue('SubName');
    const subAdd = arabicOnly(labelValue('SubAdd'));
    const workOrdDate = labelValue('WorkOrdDate');
    const workOrdNo = labelValue('WorkOrdNo');

    // بيانات فنية (Fiber Link) — نقسّم الحقول المركّبة "a / b / c"
    const splitSlash = (s) => (s || '').split('/').map((x) => x.trim());
    const cabinBT   = splitSlash(labelValue('CabinetNo/B/T'));   // [الكابينة, Fiber Block, Cabinet In]
    const dpNoT     = splitSlash(labelValue('DPNo/T'));          // [البكس, DP Terminal]
    const secBlockT = splitSlash(labelValue('SecBlockNo/T'));    // [Sec Block, Cabinet Out]
    const tech = {
      central:      arabicOnly(labelValue('ExchCode')) || null,   // اسم السنترال العربى
      cabinNumber:  cabinBT[0] || null,
      fiberBlock:   cabinBT[1] || null,
      cabinetIn:    cabinBT[2] || null,
      boxNumber:    dpNoT[0] || null,
      dpTerminal:   dpNoT[1] || null,
      secBlock:     secBlockT[0] || null,
      cabinetOut:   secBlockT[1] || null,
      primaryBlock: labelValue('SBLOCK_NO') || null,
      portNo:       labelValue('Port') || null,
      iduNo:        labelValue('IduNo') || null,
      oduNo:        labelValue('OduNo') || null,
      fiberOut:     labelValue('FiberOut') || null,
      lineType:     labelValue('LineTypeName') || null,
    };

    if (!subName && !subAdd && !tech.cabinNumber && /no rows found/.test(bodyTxt)) {
      log('•', short, '→ لا يوجد بيانات (No rows) — تسجيل فاضى');
    } else {
      log('•', short, '→', subName ? ('اسم: ' + subName.slice(0, 16)) : 'بدون اسم',
        '| كابينة:', tech.cabinNumber || '-', 'بكس:', tech.boxNumber || '-', 'DP:', tech.dpTerminal || '-', 'Port:', tech.portNo || '-');
    }
    await ingest(phone, Object.assign({ subName, subAdd, workOrdDate, workOrdNo }, tech));
    return true;
  }

  async function runAll() {
    log('🔎 جلب قائمة الأرقام المطلوبة...');
    const phones = await getPending();
    log('عدد الأرقام:', phones.length);
    if (!phones.length) { log('✅ مفيش أرقام مطلوبة — خلصنا.'); return; }
    if (!(await navigateToComplains())) return;
    let done = 0, ok = 0;
    for (const phone of phones) {
      try { if (await processOne(phone)) ok++; } catch (e) { log('خطأ فى', phone, ':', e.message); }
      done++;
      if (done % 25 === 0) log('تقدّم:', done + '/' + phones.length);
      await sleep(BETWEEN_MS);
    }
    log('✅ خلصنا — تمت معالجة', done, 'رقم (', ok, 'ناجح ). اقفل التاب.');
    setTimeout(() => { try { window.close(); } catch (e) {} }, 8000);
  }

  // مراجعة رقم واحد فقط (من زر "مراجعة" فى بحث برقم التليفون) — window.name = "sf_subinfo_one:<رقم>"
  async function runOne(phone) {
    log('🔎 مراجعة رقم واحد:', phone);
    if (!(await navigateToComplains())) return;
    try { await processOne(phone); } catch (e) { log('خطأ:', e.message); }
    log('✅ خلصنا الرقم. اقفل التاب.');
    setTimeout(() => { try { window.close(); } catch (e) {} }, 5000);
  }

  /* ===== router ===== */
  const WN   = (() => { try { return window.name || ''; } catch (e) { return ''; } })();
  const AUTO = WN === AUTO_NAME;
  const ONE  = WN.indexOf('sf_subinfo_one:') === 0 ? WN.slice('sf_subinfo_one:'.length) : '';
  async function main() {
    let isTop = true; try { isTop = (window.top === window.self); } catch (e) { isTop = false; }
    if (!isTop && !document.querySelector('input[type=password]')) return;
    log('SubInfo v1.3.1 — page:', location.pathname, AUTO ? '[AUTO]' : ONE ? ('[ONE:' + ONE + ']') : '[manual]');
    if (!AUTO && !ONE) { log('ℹ️ افتح الصفحة من زر "مراجعة الاسم والعنوان" فى Service-Flow لبدء الجلب تلقائياً.'); return; }
    if (onLogin()) { log('تسجيل الدخول...'); await doLogin(); return; }   // بعد الدخول الصفحة هتعيد التحميل والسكربت يشتغل تانى
    if (ONE) await runOne(ONE); else await runAll();
  }

  log('TE FCC SubInfo v1.3.1 loaded');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(main, 1500));
  else setTimeout(main, 1500);
})();
