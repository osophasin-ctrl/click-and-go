// /api/city-suggest.js — Vercel Serverless (CommonJS)
// อ่านรายการเมืองจาก data/cities_slim.json แล้วทำ autocomplete แบบเร็ว
// รองรับ lang=th-th|en-us, limit, q

const fs = require('fs');
const path = require('path');

const MAX_LIMIT = 30;

function qstr(req, key, def = '') {
  const v = (req.query && req.query[key]) || def;
  return (v == null ? '' : String(v)).trim();
}
function qint(req, key, def = 0) {
  const n = parseInt(qstr(req, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents
}
function loadCities() {
  // NOTE: อ่านจากโฟลเดอร์ data (ไม่ต้อง public)
  const p = path.join(process.cwd(), 'data', 'cities_slim.json');
  const raw = fs.readFileSync(p, 'utf8');
  const json = JSON.parse(raw);
  // โครง: [{ id, th, en, countryId }]
  return Array.isArray(json) ? json : [];
}

let CACHE = null;
function ensureCache() {
  if (CACHE) return CACHE;
  const src = loadCities();
  // เตรียมฟิลด์ค้นหา
  CACHE = src.map((c) => ({
    id: String(c.id),
    th: String(c.th || ''),
    en: String(c.en || ''),
    _th: normalize(c.th || ''),
    _en: normalize(c.en || ''),
  }));
  return CACHE;
}

module.exports = function handler(req, res) {
  try {
    const lang = (qstr(req, 'lang', 'th-th') || 'th-th').toLowerCase().includes('en') ? 'en' : 'th';
    const q = qstr(req, 'q');
    const limit = Math.min(Math.max(qint(req, 'limit', 20), 1), MAX_LIMIT);

    if (!q) return res.status(200).json({ ok: true, items: [] });

    const idx = ensureCache();
    const nq = normalize(q);

    const starts = [];
    const contains = [];
    for (const it of idx) {
      const key = lang === 'en' ? it._en : it._th;
      if (key.startsWith(nq)) {
        starts.push(it);
        if (starts.length >= limit) break;
      }
    }
    if (starts.length < limit) {
      for (const it of idx) {
        const key = lang === 'en' ? it._en : it._th;
        if (!key.startsWith(nq) && key.includes(nq)) {
          contains.push(it);
          if (starts.length + contains.length >= limit) break;
        }
      }
    }

    const items = [...starts, ...contains].slice(0, limit).map((c) => ({
      type: 'City',
      city_id: c.id,
      label: lang === 'en' ? c.en : c.th,
      subtitle: lang === 'en' ? 'City' : 'เมือง',
    }));

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error('city-suggest error:', err);
    return res.status(200).json({ ok: false, reason: 'internal_error' });
  }
};
