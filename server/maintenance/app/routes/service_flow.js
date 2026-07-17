const express = require('express');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const staffOnly = requireRole('admin', 'inspector');

const SF_URL = process.env.SERVICE_FLOW_API_URL
  || 'https://service-flow--menoskar42.replit.app/api/box-summary';

const SF_PHONES_URL = process.env.SERVICE_FLOW_PHONES_URL
  || 'https://service-flow--menoskar42.replit.app/api/phone-report';

async function fetchPhonePage({ q, exchange, cabinet, box, page } = {}) {
  const token = process.env.SERVICE_FLOW_API_TOKEN || process.env.SF_API_TOKEN;
  if (!token) throw new Error('SERVICE_FLOW_API_TOKEN (أو SF_API_TOKEN) غير مضبوطة في Replit Secrets');
  const u = new URL(SF_PHONES_URL);
  u.searchParams.set('page',  page || '1');
  u.searchParams.set('limit', '100');
  if (q)        u.searchParams.set('q',        q);
  if (exchange) u.searchParams.set('exchange',  exchange);
  if (cabinet)  u.searchParams.set('cabinet',   cabinet);
  if (box)      u.searchParams.set('box',        box);
  const res = await fetch(u.toString(), {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — الـ URL المستخدم: ${u.toString()}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`الـ endpoint غير صحيح — بيرجع HTML وليس JSON.\nالـ URL المستخدم: ${u.toString()}\nلتصحيحه: افتح موقع service-flow ← بيان التليفونات ← DevTools → Network ← انسخ الـ API URL وضعه في Replit Secrets باسم SERVICE_FLOW_PHONES_URL`);
  }
}

async function fetchBoxSummary({ q, page } = {}) {
  const token = process.env.SERVICE_FLOW_API_TOKEN || process.env.SF_API_TOKEN;
  if (!token) throw new Error('SERVICE_FLOW_API_TOKEN (أو SF_API_TOKEN) غير مضبوطة في Replit Secrets');
  const u = new URL(SF_URL);
  u.searchParams.set('page',  page || '1');
  u.searchParams.set('limit', '100');
  if (q) u.searchParams.set('q', q);
  const res = await fetch(u.toString(), {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} من service-flow`);
  return res.json();
}

// Normalize cabinet: keep the FULL identifier, only fix case/spacing: "2 - 8" → "2-8"
function normCab(val) {
  return String(val || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
}

// Normalize exchange: "الغنايم-دير الجنادله" → "الغنايم", "الغنايم" → "الغنايم"
function normExchange(val) {
  return String(val || '').split(/\s*-\s*/)[0].trim().toLowerCase();
}

// Builds a Map<"exchange__cabinet__box", count> from all service-flow pages
async function buildBoxCountMap() {
  const token = process.env.SERVICE_FLOW_API_TOKEN || process.env.SF_API_TOKEN;
  if (!token) return { map: new Map(), total: 0 };

  const map = new Map();
  let totalOrders = 0;

  try {
    const first = await fetchBoxSummary({ page: '1' });
    if (!first.ok || !Array.isArray(first.data) || !first.data.length)
      return { map, total: 0 };

    const cols = Object.keys(first.data[0]);
    console.log('[SF buildBoxCountMap] columns:', cols, '| sample:', JSON.stringify(first.data[0]));

    // Broad regex — matches: exchange, central, سنترال
    const exchangeCol = cols.find(c => /exchange|central|سنترال/i.test(c)) || cols[0];
    // Broad regex — matches: cabinet, cabinNumber, كابين
    const cabinetCol  = cols.find(c => /cabinet|cabin|كابين/i.test(c))     || cols[1] || cols[0];
    // Starts-with "box" — matches: box, boxNumber, box_number, بوكس
    const boxCol      = cols.find(c => /^box|بوكس/i.test(c))               || cols[2] || cols[1];
    // Exact/anchored count — avoid matching "boxNumber" via "num"
    const countCol    = cols.find(c => /^count$|عدد|^total$|^orders$|ordercount/i.test(c))
                     || cols.find(c => /count|عدد|total/i.test(c) && !/box|cabin|central/i.test(c))
                     || cols[cols.length - 1];

    console.log('[SF buildBoxCountMap] mapped → exchange:', exchangeCol, '| cabinet:', cabinetCol, '| box:', boxCol, '| count:', countCol);

    const processPage = (rows) => rows.forEach(row => {
      const key = [
        normExchange(row[exchangeCol]),
        normCab(row[cabinetCol]),
        String(row[boxCol] || '').trim(),
      ].join('__').toLowerCase();
      const cnt = parseInt(row[countCol]) || 1;
      map.set(key, (map.get(key) || 0) + cnt);
      totalOrders += cnt;
    });

    processPage(first.data);

    const maxPages = (first.total && first.limit)
      ? Math.min(Math.ceil(first.total / first.limit), 30) : 1;

    if (maxPages > 1) {
      const rest = await Promise.allSettled(
        Array.from({ length: maxPages - 1 }, (_, i) => fetchBoxSummary({ page: String(i + 2) }))
      );
      rest.forEach(r => {
        if (r.status === 'fulfilled' && r.value.ok && Array.isArray(r.value.data))
          processPage(r.value.data);
      });
    }
  } catch (e) {
    console.error('[SF buildBoxCountMap] error:', e.message);
  }

  return { map, total: totalOrders };
}

router.get('/', staffOnly, async (req, res) => {
  const { q, page = '1' } = req.query;
  let rows = [], columns = [], error = null, totalPages = 1;
  try {
    const data = await fetchBoxSummary({ q, page });
    if (data.ok && Array.isArray(data.data)) {
      rows = data.data;
      if (rows.length) columns = Object.keys(rows[0]);
      if (data.total && data.limit) totalPages = Math.ceil(data.total / data.limit);
    } else {
      error = data.error || 'خطأ في الاستجابة من service-flow';
    }
  } catch (e) {
    error = e.message;
  }
  res.render('reports/service_flow_boxes', {
    title: 'ملخص البوكسيات - الطلبات المتعذرة',
    rows, columns, error, query: req.query,
    currentPage: parseInt(page), totalPages,
  });
});

module.exports = router;
module.exports.buildBoxCountMap  = buildBoxCountMap;
module.exports.fetchPhonePage    = fetchPhonePage;
module.exports.buildPhoneFirstMap = buildPhoneFirstMap;

// Builds Map<"exchange__cabinet__box", first_phone_number> from all phone-report pages
async function buildPhoneFirstMap() {
  const token = process.env.SERVICE_FLOW_API_TOKEN || process.env.SF_API_TOKEN;
  if (!token) return new Map();
  const map = new Map();
  try {
    const first = await fetchPhonePage({ page: '1' });
    if (!first.ok || !Array.isArray(first.data) || !first.data.length) return map;

    const cols = Object.keys(first.data[0]);
    const exchangeCol = cols.find(c => /exchange|central|سنترال/i.test(c)) || cols[0];
    const cabinetCol  = cols.find(c => /cabinet|cabin|كابين/i.test(c))     || cols[1] || cols[0];
    const boxCol      = cols.find(c => /^box|بوكس/i.test(c))               || cols[2] || cols[1];
    // phone: prefer full/complete phone column, then any phone/تليفون column
    const phoneCol    = cols.find(c => /full.*phone|phone.*full|تليفون.*كامل|كامل.*تليفون/i.test(c))
                     || cols.find(c => /phone|تليفون|telephone/i.test(c))
                     || cols[cols.length - 1];

    console.log('[SF buildPhoneFirstMap] exchange:', exchangeCol, '| cabinet:', cabinetCol, '| box:', boxCol, '| phone:', phoneCol);

    const processPage = (rows) => rows.forEach(row => {
      const key = [
        normExchange(row[exchangeCol]),
        normCab(row[cabinetCol]),
        String(row[boxCol] || '').trim(),
      ].join('__').toLowerCase();
      if (!map.has(key) && row[phoneCol] != null && String(row[phoneCol]).trim()) {
        map.set(key, String(row[phoneCol]).trim());
      }
    });

    processPage(first.data);

    if (first.total && first.limit) {
      const maxPages = Math.min(Math.ceil(first.total / first.limit), 200);
      if (maxPages > 1) {
        const rest = await Promise.allSettled(
          Array.from({ length: maxPages - 1 }, (_, i) => fetchPhonePage({ page: String(i + 2) }))
        );
        rest.forEach(r => {
          if (r.status === 'fulfilled' && r.value.ok && Array.isArray(r.value.data))
            processPage(r.value.data);
        });
      }
    }
  } catch (e) { console.error('[SF buildPhoneFirstMap] error:', e.message); }
  return map;
}
