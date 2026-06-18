// ==UserScript==
// @name         TE FCC + WFM + OSS Export
// @namespace    te.eg.autoexport
// @version      2.5
// @description  FCC then WFM then OSS export + auto-upload to Service-Flow.
// @match        https://fcc.te.eg/TroubleTicket/faces/*
// @match        https://wfm.te.eg/WorkOrder/faces/*
// @match        https://oss.te.eg:15201/om*
// @match        https://oss.te.eg:15204/cas/*
// @run-at       document-idle
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  /* ================================================================
     ⚙️ CONFIG — عدّل السطرين دول بس
     ================================================================ */
  const SF_URL          = 'https://YOUR-SERVICE-FLOW-REPLIT-URL'; // رابط موقع Service-Flow بدون / في الآخر
  const SF_UPLOAD_TOKEN = 'sf-auto-upload-2026';                  // نفس القيمة في UPLOAD_TOKEN على السيرفر
  /* ================================================================ */

  /* ---------- anti-devtool guard ---------- */
  (function hardenAgainstDevtoolGuard() {
    try {
      const _alert = window.alert ? window.alert.bind(window) : null;
      window.alert = function (m) {
        const s = String(m == null ? '' : m).toLowerCase();
        if (s.includes('console') || s.includes('devtool') || s.includes('prohibit')) return;
        return _alert ? _alert(m) : undefined;
      };
    } catch (e) {}
    try { console.clear = function () {}; } catch (e) {}
    try {
      setInterval(function () {
        const lays = document.querySelectorAll('.layui-layer');
        for (let i = 0; i < lays.length; i++) {
          const lay = lays[i];
          const t = (lay.textContent || '').toLowerCase();
          if (t.includes('console') || t.includes('devtool') || t.includes('prohibit')) {
            const ok = lay.querySelector('.layui-layer-btn0') || lay.querySelector('.layui-layer-close');
            if (ok) { try { ok.click(); } catch (e) {} } else { try { lay.remove(); } catch (e) {} }
          }
        }
      }, 1000);
    } catch (e) {}
  })();

  const CREDS = {
    'fcc.te.eg':       { user: 'mena.haleem', pass: 'Mon_oskar352' },
    'wfm.te.eg':       { user: 'mina109756',  pass: 'Mon_oskar11' },
    'oss.te.eg:15204': { user: 'MENA.HALEEM', pass: 'Mon_oskar352' },
  };
  const LOGIN_URL = {
    'fcc.te.eg':       'https://fcc.te.eg/TroubleTicket/faces/security/pages/Login.jsf',
    'wfm.te.eg':       'https://wfm.te.eg/WorkOrder/faces/security/pages/Login.jsf',
    'oss.te.eg:15201': 'https://oss.te.eg:15201/om',
    'oss.te.eg:15204': 'https://oss.te.eg:15201/om',
  };

  /* ---------- on-screen logger ---------- */
  const log = (() => {
    let box;
    return (...a) => {
      console.log('%c[TE]', 'color:#0a8', ...a);
      if (!box) {
        box = document.createElement('div');
        box.style.cssText = 'position:fixed;z-index:2147483647;bottom:8px;right:8px;max-width:420px;max-height:42vh;overflow:auto;background:#0b1020;color:#7fffd4;font:12px/1.45 monospace;padding:8px 10px;border:1px solid #0a8;border-radius:8px;opacity:.93;white-space:pre-wrap;direction:ltr;text-align:left';
        (document.documentElement || document.body).appendChild(box);
      }
      const line = document.createElement('div');
      line.textContent = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    };
  })();

  /* ---------- helpers ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm  = s  => (s || '').replace(/\s+/g, ' ').trim();

  async function waitFor(predicate, { timeout = 30000, interval = 400, label = '' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      let v;
      try { v = predicate(); } catch (e) { v = null; }
      if (v) return v;
      await sleep(interval);
    }
    throw new Error('waitFor timeout: ' + label);
  }

  function byText(root, selector, text, { exact = true, ci = true } = {}) {
    let t = norm(text);
    if (ci) t = t.toLowerCase();
    return Array.from(root.querySelectorAll(selector)).find(el => {
      let c = norm(el.textContent || el.value || '');
      if (ci) c = c.toLowerCase();
      return exact ? c === t : c.includes(t);
    });
  }

  function bestText(root, selector, needle) {
    const n = norm(needle).toLowerCase();
    let best = null, bestLen = Infinity;
    Array.from(root.querySelectorAll(selector)).forEach(el => {
      const txt = norm(el.textContent).toLowerCase();
      if (txt.includes(n) && txt.length < bestLen) { best = el; bestLen = txt.length; }
    });
    return best;
  }

  function fire(el, type) {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); } catch (e) {}
  }

  function realClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { ['mousedown', 'mouseup', 'click'].forEach(t => fire(el, t)); }
    catch (e) { try { el.click(); } catch (e2) {} }
    return true;
  }

  function setField(el, value) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    } catch (e) { el.value = value; }
    ['input', 'change', 'blur', 'keyup'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  }

  function looksBroken() {
    const t = norm(document.body ? document.body.textContent : '').toLowerCase();
    return /internal server error|http status 500|error 500|the server encountered an unexpected/.test(t);
  }

  async function activate(el, done) {
    const ok = () => done ? done() : false;
    let card = el, clickable = null;
    for (let i = 0; i < 6 && card; i++) {
      clickable = card.querySelector('a[href], a[onclick], a[role="button"], a, [onclick], [role="button"]');
      if (clickable) break;
      card = card.parentElement;
    }
    const targets = [];
    if (clickable) targets.push(clickable);
    targets.push(el);
    if (card && card !== el && targets.indexOf(card) === -1) targets.push(card);
    for (const t of targets) {
      if (ok()) return true;
      try { t.click(); } catch (e) {}
      await sleep(1700);
      if (ok()) return true;
      realClick(t);
      await sleep(1700);
      if (ok()) return true;
      fire(t, 'dblclick');
      await sleep(1500);
      if (ok()) return true;
    }
    return ok();
  }

  /* ================================================================
     📤 Service-Flow auto-upload
     ================================================================ */

  function uploadToSF(blob, filename, endpoint) {
    if (!SF_URL || SF_URL.includes('YOUR-SERVICE-FLOW')) {
      log('⚠️  SF_URL غير مضبوط — عدّل الكود أعلاه');
      return;
    }
    log('📤 جاري الرفع إلى Service-Flow:', endpoint, '(' + Math.round(blob.size / 1024) + ' KB)');
    const fd = new FormData();
    fd.append('file', blob, filename);
    GM_xmlhttpRequest({
      method: 'POST',
      url: SF_URL + endpoint,
      headers: { 'X-Upload-Token': SF_UPLOAD_TOKEN },
      data: fd,
      onload: r => {
        try {
          const j = JSON.parse(r.responseText);
          log('✅ SF رُفع بنجاح:', JSON.stringify(j));
        } catch (e) {
          log('✅ SF status', r.status, ':', r.responseText.slice(0, 120));
        }
      },
      onerror: e => log('❌ SF upload error:', endpoint, String(e)),
    });
  }

  // استخراج MIME type واسم الملف من response headers
  function parseCd(headers) {
    const cd   = headers || '';
    const mt   = (cd.match(/content-type:\s*([^\r\n;]+)/i) || ['', 'application/vnd.ms-excel'])[1].trim();
    const name = (cd.match(/filename[^=]*=\s*["']?([^"';\r\n]+)/i) || ['', ''])[1].trim() || null;
    return { mt, name };
  }

  // رفع عبر GET على رابط مباشر
  function captureViaGet(url, baseOrigin, fallback, filename, endpoint) {
    const absUrl = url.startsWith('http') ? url : baseOrigin + url;
    log('Trying GET:', absUrl.slice(0, 100));
    GM_xmlhttpRequest({
      method: 'GET',
      url: absUrl,
      responseType: 'arraybuffer',
      onload: r => {
        const headers = r.responseHeaders || '';
        if (r.status === 200 && headers.toLowerCase().includes('attachment')) {
          const { mt, name } = parseCd(headers);
          uploadToSF(new Blob([r.response], { type: mt }), name || filename, endpoint);
        } else {
          log('GET لم يُرجع ملفاً (status:', r.status + ') — جرب form replay');
          if (fallback) fallback();
        }
      },
      onerror: () => { if (fallback) fallback(); },
    });
  }

  // رفع عبر إعادة إرسال form (JSF ViewState)
  function captureViaFormReplay(exportEl, filename, endpoint) {
    const form = exportEl && exportEl.closest
      ? (exportEl.closest('form') || document.querySelector('form'))
      : document.querySelector('form');
    if (!form) { log('Form replay: لا يوجد <form>'); return; }

    const params = new URLSearchParams();
    Array.from(form.querySelectorAll('input, select')).forEach(inp => {
      if (!inp.name) return;
      if (inp.type === 'file') return;
      if ((inp.type === 'checkbox' || inp.type === 'radio') && !inp.checked) return;
      params.append(inp.name, inp.value || '');
    });
    const target = exportEl && exportEl.closest ? (exportEl.closest('[name]') || exportEl) : null;
    if (target && target.name) params.append(target.name, target.value || '');

    log('Form replay POST to:', (form.action || location.href).slice(0, 100));
    GM_xmlhttpRequest({
      method: 'POST',
      url: form.action || location.href,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: params.toString(),
      responseType: 'arraybuffer',
      onload: r => {
        const headers = r.responseHeaders || '';
        if (r.status === 200 && headers.toLowerCase().includes('attachment')) {
          const { mt, name } = parseCd(headers);
          uploadToSF(new Blob([r.response], { type: mt }), name || filename, endpoint);
        } else {
          log('Form replay: الرد ليس ملفاً (status:', r.status + ')');
          log('الملف نزل على جهازك فقط (JSF AJAX export)');
        }
      },
      onerror: e => log('Form replay error:', String(e)),
    });
  }

  // الدالة الرئيسية للالتقاط — تجرب GET href أولاً ثم form replay
  function captureAndUpload(exportEl, filename, endpoint) {
    if (!exportEl) return;
    const href = (exportEl.href || '').trim();
    if (href && !/^(javascript|#|about:)/i.test(href)) {
      captureViaGet(href, location.origin, () => captureViaFormReplay(exportEl, filename, endpoint), filename, endpoint);
    } else {
      captureViaFormReplay(exportEl, filename, endpoint);
    }
  }

  // التقاط خاص بـ OSS: يحلل الـ onclick ليجد رابط التحميل
  function captureOSS(downloadAnchor, ossOrigin) {
    const onclick = downloadAnchor.getAttribute('onclick') || '';

    // محاولة استخراج URL من onclick بأنماط مختلفة
    let dlUrl = null;
    let m;

    // نمط: window.open('url') أو window.open("url")
    m = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i);
    if (m) dlUrl = m[1];

    // نمط: location.href = 'url' أو window.location = 'url'
    if (!dlUrl) {
      m = onclick.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i);
      if (m) dlUrl = m[1];
    }

    // نمط: أي مسار يحتوي على download أو export
    if (!dlUrl) {
      m = onclick.match(/['"]([^'"]*(?:download|export)[^'"]*)['"]/i);
      if (m) dlUrl = m[1];
    }

    if (dlUrl) {
      captureViaGet(dlUrl, ossOrigin, null, 'oss_om.xlsx', '/api/ftth-orders/import');
    } else {
      // طباعة الـ onclick كاملاً لنحدد النمط ونعدل الـ regex لاحقاً
      log('OSS: لم يُعثر على URL في onclick — الملف سينزل على جهازك فقط');
      log('OSS onclick:', onclick.slice(0, 300));
    }
  }

  /* ---------- login (shared) ---------- */
  async function doLogin() {
    const onLogin = () => /Login\.jsf/i.test(location.href) || /\/cas\//i.test(location.href);
    const c = CREDS[location.host];
    if (c && c.pass) {
      const pw = await waitFor(
        () => document.querySelector('input[type=password]'),
        { timeout: 15000, interval: 300, label: 'password field' }
      ).catch(() => null);
      if (pw) {
        const scope  = pw.closest('form') || document;
        const userEl = scope.querySelector('input[type=text]') || document.querySelector('input[type=text]');
        setField(userEl, c.user);
        setField(pw, c.pass);
        log('filled credentials (user:', c.user + ')');
        await sleep(400);
      }
    }

    const TERMS   = ['login','log in','log on','logon','sign in','signin','تسجيل الدخول','تسجيل دخول','دخول','الدخول'];
    const labelOf = el => norm(el.value) || norm(el.textContent) || norm(el.alt) || norm(el.getAttribute('aria-label')) || norm(el.title);
    const isLogin = el => { const l = labelOf(el).toLowerCase(); return l.length > 0 && l.length <= 24 && TERMS.some(t => l.includes(t)); };
    const rank    = el => {
      const tag = el.tagName.toLowerCase(), type = (el.type || '').toLowerCase();
      if (tag === 'input' && (type === 'submit' || type === 'image')) return 0;
      if (tag === 'button') return 1;
      if (tag === 'a' && el.getAttribute('onclick')) return 2;
      if (tag === 'input' && type === 'button') return 3;
      return 4;
    };

    let cands = [];
    try {
      await waitFor(() => {
        cands = Array.from(document.querySelectorAll(
          'input[type=submit],button,input[type=image],input[type=button],a[onclick],a[role=button],a'
        )).filter(isLogin).sort((a, b) => rank(a) - rank(b));
        return cands.length;
      }, { timeout: 20000, interval: 400, label: 'login candidates' });
    } catch (e) {}

    for (const btn of cands) {
      try { btn.click(); } catch (e) {}
      await sleep(1600);
      if (!onLogin()) { log('LOGIN OK'); return; }
      realClick(btn);
      await sleep(1800);
      if (!onLogin()) { log('LOGIN OK'); return; }
    }
    log('STILL on login.');
  }

  function chainTo(key, url) {
    try {
      const last = GM_getValue(key, 0);
      if (Date.now() - last > 60000) {
        GM_setValue(key, Date.now());
        GM_openInTab(url, { active: true, setParent: true });
        log('opening', url);
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

    if (/\/faces\/Home/i.test(location.href) && !fccHasSearch()) {
      const TILE_SEL = 'a,button,span,td,div,h1,h2,h3,h4,p';
      let tile;
      try {
        tile = await waitFor(() =>
          bestText(document, TILE_SEL, 'قائمة الشكاو') || bestText(document, TILE_SEL, 'ticket queue') ||
          bestText(document, TILE_SEL, 'قائمة')        || bestText(document, TILE_SEL, 'ticket') ||
          bestText(document, TILE_SEL, 'queue'),
          { label: 'Ticket Queue tile', timeout: 20000 });
      } catch (e) { log('tile not found:', e.message); }
      if (tile) {
        log('tile ->', tile.tagName, JSON.stringify(norm(tile.textContent).slice(0, 24)));
        const opened = await activate(tile, () => !/\/faces\/Home/i.test(location.href) || fccHasSearch());
        if (!opened) { log('tile did NOT open.'); return; }
      }
    }

    const searchWrap = await waitFor(
      () => document.querySelector('[id$="SearchOptions:_search"]') || document.querySelector('[id$=":_search"]'),
      { label: 'search button', timeout: 25000 });
    realClick(searchWrap.querySelector('a[role="button"], a') || searchWrap);
    log('search clicked, waiting for results');
    await sleep(4000);

    const exportLink = await waitFor(
      () => byText(document, 'a', 'تصدير', { exact: true }) ||
            byText(document, 'a,button,input[type=submit]', 'Export', { exact: false }),
      { label: 'export button', timeout: 25000 });

    // رفع تلقائي إلى Service-Flow (بالتوازي مع التحميل العادي)
    captureAndUpload(exportLink, 'fcc_ticket_queue.xlsx', '/api/ticket-queue/import');

    realClick(exportLink);
    log('FCC export clicked. DONE.');
    chainTo('wfm_opened_at', LOGIN_URL['wfm.te.eg']);
  }

  /* =======================================================================
     WFM  (Maintenance Orders)
     ===================================================================== */
  async function runWFM() {
    log('WFM flow');
    if (/Login\.jsf/i.test(location.href)) { await doLogin(); return; }

    const opsMenu = () =>
      bestText(document, 'a,div,span,td,button,li', 'العمليات') ||
      bestText(document, 'a,div,span,td,button,li', 'operations');

    if (!opsMenu()) {
      let wo;
      try {
        wo = await waitFor(() =>
          bestText(document, 'a,button,span,td,div,h1,h2,h3,h4,p', 'طلبات العمل') ||
          bestText(document, 'a,button,span,td,div,h1,h2,h3,h4,p', 'work order'),
          { label: 'Work Orders tile', timeout: 15000 });
      } catch (e) { log('Work Orders not found:', e.message); }
      if (wo) {
        log('WO ->', wo.tagName, JSON.stringify(norm(wo.textContent).slice(0, 24)));
        await activate(wo, opsMenu);
      }
    }

    const ops = await waitFor(opsMenu, { label: 'Operations menu', timeout: 20000 });
    log('ops menu ->', ops.tagName, JSON.stringify(norm(ops.textContent).slice(0, 20)));
    realClick(ops);
    const opsLink = ops.closest('a') || ops.querySelector('a');
    if (opsLink && opsLink !== ops) realClick(opsLink);
    await sleep(1300);

    const excel = await waitFor(() =>
      bestText(document, '[role="menuitem"],a,div,span,td,li', 'تحميل اكسل') ||
      bestText(document, '[role="menuitem"],a,div,span,td,li', 'اكسل')        ||
      bestText(document, '[role="menuitem"],a,div,span,td,li', 'excel'),
      { label: 'Download Excel item', timeout: 15000 });
    log('excel item ->', excel.tagName, JSON.stringify(norm(excel.textContent).slice(0, 24)));
    realClick(excel);
    log('Download Excel clicked');

    try {
      const exportBtn = await waitFor(() =>
        byText(document, 'a,button,input[type=submit]', 'Export', { exact: false }) ||
        byText(document, 'a,button,input[type=submit]', 'تصدير', { exact: false }),
        { label: 'Export popup button', timeout: 12000 });

      // رفع تلقائي إلى Service-Flow (بالتوازي مع التحميل العادي)
      captureAndUpload(exportBtn, 'wfm_orders.xlsx', '/api/maintenance-orders/import');

      realClick(exportBtn);
      log('WFM Export clicked. DONE.');
    } catch (e) {
      log('WFM: Export not in same document. If a separate popup opened, press Export there once.');
    }

    chainTo('oss_opened_at', 'https://oss.te.eg:15201/om');
  }

  /* =======================================================================
     OSS  (Abnormal WO / متعذرات OM)
     ===================================================================== */
  function getAbnormalDoc() {
    for (let i = 0; i < window.frames.length; i++) {
      try {
        const d = window.frames[i].document;
        if (/exception_wotask\.jsp/i.test(d.URL)) return { win: window.frames[i], doc: d };
        for (let j = 0; j < window.frames[i].frames.length; j++) {
          try {
            const dd = window.frames[i].frames[j].document;
            if (/exception_wotask\.jsp/i.test(dd.URL)) return { win: window.frames[i].frames[j], doc: dd };
          } catch (e) {}
        }
      } catch (e) {}
    }
    return null;
  }

  function collectDocs() {
    const docs = [document];
    for (let i = 0; i < window.frames.length; i++) {
      try { if (window.frames[i].document) docs.push(window.frames[i].document); } catch (e) {}
      try {
        for (let j = 0; j < window.frames[i].frames.length; j++) {
          try { if (window.frames[i].frames[j].document) docs.push(window.frames[i].frames[j].document); } catch (e) {}
        }
      } catch (e) {}
    }
    return docs;
  }

  function findAbnormalCandidates() {
    const SEL = 'a,span,div,li,td,p,cite,button,dd,b,font';
    const out = [];
    for (const doc of collectDocs()) {
      let els;
      try { els = Array.from(doc.querySelectorAll(SEL)); } catch (e) { continue; }
      for (const el of els) {
        const txt = norm(el.textContent).toLowerCase();
        if (txt.includes('abnormal wo') && txt.length <= 24) out.push(el);
      }
    }
    out.sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
    return out.slice(0, 4);
  }

  async function openAbnormalTab() {
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (getAbnormalDoc()) return true;
      const cands = findAbnormalCandidates();
      log('Abnormal WO candidates:', cands.length, '(attempt ' + attempt + ')');
      for (const el of cands) {
        const opened = await activate(el, () => !!getAbnormalDoc());
        if (opened || getAbnormalDoc()) { log('Abnormal WO tab opened'); return true; }
      }
      await sleep(1200);
    }
    return false;
  }

  const ASSIUT_RE = /assiut|asyut|أسيوط|اسيوط/i;

  function findGovOption(sel) {
    if (!sel || !sel.options) return null;
    return Array.from(sel.options).find(o =>
      ASSIUT_RE.test((o.value || '').trim()) || ASSIUT_RE.test((o.textContent || '').trim())
    );
  }

  function openSelect(sel) {
    const win = (sel.ownerDocument && sel.ownerDocument.defaultView) || window;
    try { sel.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { sel.focus(); } catch (e) {}
    ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => {
      try { sel.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: win })); } catch (e) {}
    });
    try { sel.dispatchEvent(new Event('focus', { bubbles: true })); } catch (e) {}
    try { sel.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', keyCode: 40, which: 40 })); } catch (e) {}
  }

  function selectForLabel(lab) {
    const tries = [];
    if (lab.parentElement) tries.push(lab.parentElement);
    let n = lab.nextElementSibling, c = 0;
    while (n && c < 4) { tries.push(n); n = n.nextElementSibling; c++; }
    const cell = lab.parentElement;
    if (cell) { let m = cell.nextElementSibling, k = 0; while (m && k < 3) { tries.push(m); m = m.nextElementSibling; k++; } }
    for (const el of tries) {
      if (el.tagName === 'SELECT') return el;
      const s = el.querySelector && el.querySelector('select');
      if (s) return s;
    }
    return null;
  }

  function findGovSelect(doc) {
    let s = doc.getElementById('governorateQ');
    if (s && s.tagName === 'SELECT') return s;
    const labs = Array.from(doc.querySelectorAll('label,span,div,td,p,th,dt,b,font'))
      .filter(el => el.children.length === 0 && /^governorate$/i.test(norm(el.textContent)));
    for (const lab of labs) { const sel = selectForLabel(lab); if (sel) return sel; }
    return Array.from(doc.querySelectorAll('select')).find(sel => findGovOption(sel)) || null;
  }

  async function runOSS() {
    log('OSS flow');
    if (/\/cas\//i.test(location.href)) { await doLogin(); return; }

    const opened = await openAbnormalTab();
    if (!opened) log('Auto-open failed. Click "Abnormal WO" in the LEFT menu now; the script will continue automatically.');

    const frame = await waitFor(getAbnormalDoc, { label: 'OSS Abnormal frame', timeout: 120000, interval: 800 });
    const d = frame.doc;
    await sleep(1500);
    log('Abnormal frame found');

    const moreSearch = await waitFor(() => d.getElementById('moresearch'), { label: 'OSS More Search', timeout: 20000 });
    realClick(moreSearch);
    await sleep(1200);
    log('More Search expanded');

    let govSel = null;
    try {
      await waitFor(
        () => { govSel = findGovSelect(d); return !!govSel; },
        { label: 'OSS Governorate select', timeout: 30000, interval: 600 }
      );
    } catch (e) {
      log('Governorate <select> not found. Selects in frame:',
          Array.from(d.querySelectorAll('select')).map(s => '#' + (s.id || '?')).join(' '));
      throw e;
    }
    log('gov select #' + (govSel.id || '?') + ' located');

    let govOpt = null, loggedOpts = false, prompted = false;
    const gStart = Date.now();
    while (Date.now() - gStart < 25000) {
      openSelect(govSel);
      govOpt = findGovOption(govSel);
      if (govOpt) break;
      const nOpts = govSel.options ? govSel.options.length : 0;
      if (!loggedOpts && nOpts > 0) {
        loggedOpts = true;
        log('gov opts:', Array.from(govSel.options).slice(0, 14)
            .map(o => (o.value || '') + '="' + norm(o.textContent) + '"').join(' | ').slice(0, 300));
      }
      if (!prompted && Date.now() - gStart > 12000) {
        prompted = true;
        try { govSel.scrollIntoView({ block: 'center' }); } catch (e) {}
        log('(optional) click the Governorate dropdown once; otherwise Assiut will be injected directly.');
      }
      await sleep(700);
    }

    if (!govOpt) {
      const o = d.createElement('option');
      o.value = 'Assiut'; o.textContent = 'Assiut'; o.selected = true;
      govSel.appendChild(o);
      govOpt = o;
      log('Governorate options did not load; injected "Assiut" directly.');
    }

    govSel.value = govOpt.value;
    govSel.dispatchEvent(new Event('change', { bubbles: true }));
    if (frame.win.jQuery) { try { frame.win.jQuery(govSel).trigger('change'); } catch (e) {} }
    try { govSel.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', keyCode: 27 })); } catch (e) {}
    try { govSel.blur(); } catch (e) {}
    try { if (frame.win.layui && frame.win.layui.form) frame.win.layui.form.render('select'); } catch (e) {}
    try {
      let layuiSelect = govSel.nextElementSibling;
      if (!(layuiSelect && layuiSelect.classList && layuiSelect.classList.contains('layui-form-select'))) {
        const wrap = govSel.closest('.layui-form-item, .layui-input-inline, .layui-form-select') || govSel.parentElement;
        layuiSelect = (wrap && wrap.querySelector('.layui-form-select')) || null;
      }
      if (layuiSelect) {
        realClick(layuiSelect.querySelector('.layui-select-title') || layuiSelect);
        await sleep(300);
        const dd = Array.from(layuiSelect.querySelectorAll('dl dd')).find(x => ASSIUT_RE.test(norm(x.textContent)));
        if (dd) realClick(dd);
      }
    } catch (e) {}
    log('Governorate set ->', govOpt.value, '/', norm(govOpt.textContent));

    realClick(d.getElementById('search'));
    log('Search clicked, waiting ~10s');
    await sleep(10000);

    realClick(d.getElementById('btn_export'));
    const taskInput = await waitFor(() => d.querySelector('input.layui-layer-input'), { label: 'OSS task-name input' });
    taskInput.focus();
    taskInput.value = 'claude';
    taskInput.dispatchEvent(new Event('input', { bubbles: true }));
    realClick(d.querySelector('a.layui-layer-btn0'));
    log('export task "claude" submitted');
    await sleep(1500);

    realClick(d.getElementById('btn_task'));

    function getTaskDoc() {
      try {
        for (let i = 0; i < frame.win.frames.length; i++) {
          const td = frame.win.frames[i].document;
          if (/toTask\.ilf/i.test(td.URL)) return { win: frame.win.frames[i], doc: td };
        }
      } catch (e) {}
      return null;
    }
    const task = await waitFor(getTaskDoc, { label: 'OSS Task window', timeout: 20000 });
    await sleep(20000);

    const downloadAnchor = await waitFor(() => {
      const rb = task.doc.getElementById('btn_refresh');
      if (rb) realClick(rb);
      const rows = Array.from(task.doc.querySelectorAll('table tr'));
      for (const tr of rows) {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 6) {
          const name   = norm(tds[2].textContent);
          const status = norm(tds[4].textContent);
          if (name === 'claude' && /Completed/i.test(status)) {
            const a = tds[5].querySelector('a[onclick]');
            if (a) return a;
          }
        }
      }
      return null;
    }, { label: 'OSS newest completed claude row', timeout: 300000, interval: 10000 });

    log('OSS downloading:', norm(downloadAnchor.textContent));

    // رفع تلقائي إلى Service-Flow — يحلل الـ onclick ليجد رابط التحميل
    const ossOrigin = 'https://oss.te.eg:15201';
    captureOSS(downloadAnchor, ossOrigin);

    realClick(downloadAnchor);
    log('OSS download triggered. DONE (clicked once).');
  }

  /* ---------- router ---------- */
  async function main() {
    let isTop = true;
    try { isTop = (window.top === window.self); } catch (e) { isTop = false; }
    if (!isTop && !document.querySelector('input[type=password]')) return;

    log('page:', location.host, location.pathname, isTop ? '[top]' : '[frame]');

    if (looksBroken()) {
      const home = LOGIN_URL[location.host] || LOGIN_URL['fcc.te.eg'];
      let last = 0; try { last = GM_getValue('recover_at', 0); } catch (e) {}
      if (Date.now() - last > 8000) {
        try { GM_setValue('recover_at', Date.now()); } catch (e) {}
        log('server error (500) detected, restarting from login...');
        location.href = home;
      } else { log('server error; just redirected, not looping.'); }
      return;
    }

    const host = location.host;
    try {
      if      (host.startsWith('fcc.te.eg')) await runFCC();
      else if (host.startsWith('wfm.te.eg')) await runWFM();
      else if (host.startsWith('oss.te.eg')) await runOSS();
    } catch (e) {
      log('ERROR:', e.message || String(e));
      console.error('[TE] error:', e);
    }
  }

  log('TE FCC + WFM + OSS Export v2.5 loaded on', location.host);
  setTimeout(main, 1500);
})();
