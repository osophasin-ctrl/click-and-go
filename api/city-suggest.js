// /api/city-suggest.js — Vercel/Node serverless
// อ่านรายการเมืองจาก data/cities_slim.json แล้วทำ autocomplete
// รองรับ lang=th-th|en-us (จะถูกย่อเป็น th|en) และ limit, q

const fs = require('fs');
const path = require('path');

const MAX_LIMIT = 30;
const CACHE = { cities: null, mtime: 0 };

// ---------- helpers ----------
function qstr(req, key, def = '') {
  const v = (req.query && req.query[key]) ?? def;
  return (v == null ? '' : String(v)).trim();
}
function qint(req, key, def = 0) {
  const n = parseInt(qstr(req, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}
function toLang(s = '') {
  const v = String(s).toLowerCase();
  if (v.startsWith('en')) return 'en';
  return 'th';
}
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents
}

// หาไฟล์ cities_slim.json แบบหลาย candidate เผื่อสภาพแวดล้อม build ต่างกัน
function resolveCitiesPath() {
  const candidates = [
    path.join(process.cwd(), 'data', 'cities_slim.json'),
    path.join(__dirname, '..', 'data', 'cities_slim.json'),
    path.join(process.cwd(), 'public', 'data', 'cities_slim.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function loadCities() {
  const now = Date.now();
  if (CACHE.cities && now - CACHE.mtime < 5 * 60 * 1000) {
    return CACHE.cities;
  }
  const p = resolveCitiesPath();
  if (!p) throw new Error('cities_slim.json not found');

  const raw = fs.readFileSync(p, 'utf8');
  const arr = JSON.parse(raw); // โครงสร้าง: [{ id, th, en, countryId }, ...]
  // เตรียมฟิลด์ค้นหา
  const prepared = arr
    .map((it) => ({
      id: String(it.id),
      th: String(it.th || ''),
      en: String(it.en || ''),
      _nth: normalize(it.th || ''),
      _nen: normalize(it.en || ''),
    }))
    .filter((x) => x.id && (x.th || x.en));

  CACHE.cities = prepared;
  CACHE.mtime = now;
  return prepared;
}

// ---------- handler ----------
module.exports = async function handler(req, res) {
  try {
    const lang = toLang(qstr(req, 'lang', 'th-th')); // th | en
    const q = qstr(req, 'q', '');
    const limit = Math.min(Math.max(qint(req, 'limit', 10), 1), MAX_LIMIT);

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

    if (!q) {
      return res.status(200).json({ ok: true, items: [] });
    }

    const cities = loadCities();
    const nq = normalize(q);

    const starts = [];
    const contains = [];

    // เลือกฟิลด์ค้นหาตามภาษา
    const normKey = lang === 'en' ? '_nen' : '_nth';

    // prefix match ก่อน
    for (const it of cities) {
      if ((it[normKey] || '').startsWith(nq)) {
        starts.push(it);
        if (starts.length >= limit) break;
      }
    }
    // ไม่พอค่อยตามด้วย contains
    if (starts.length < limit) {
      for (const it of cities) {
        if (!(it[normKey] || '').startsWith(nq) && (it[normKey] || '').includes(nq)) {
          contains.push(it);
          if (starts.length + contains.length >= limit) break;
        }
      }
    }

    const pickLabel = (it) => (lang === 'en' ? it.en || it.th : it.th || it.en);

    const items = [...starts, ...contains]
      .slice(0, limit)
      .map((it) => ({
        type: 'City',
        city_id: it.id,
        label: pickLabel(it),
      }));

    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error('city-suggest error:', err);
    // ส่งกลับ ok:false เพื่อให้ฝั่งหน้าเว็บแสดง “ไม่พบคำแนะนำ”
    return res.status(200).json({ ok: false, reason: 'internal_error' });
  }
};
