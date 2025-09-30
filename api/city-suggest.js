// /api/city-suggest.js — Vercel Serverless (CommonJS)
// Suggest เมืองจากไฟล์ใน public/city-index/{th|en}.json
// รองรับ ?q=, ?limit=, ?lang=(th-th|en-us|th|en)
// ส่งกลับ: { ok:true, items:[ {type:'city', city_id, label} ] }

const fs = require('fs');
const path = require('path');

const MAX_LIMIT = 30;
const CACHE = { th: null, en: null };

// ---------- utils ----------
function qstr(req, key, def = '') {
  const v = (req.query && req.query[key]) || def;
  return (v == null ? '' : String(v)).trim();
}
function qint(req, key, def = 0) {
  const n = parseInt(qstr(req, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ''); // ตัดวรรณยุกต์/accents (ช่วยภาษาอังกฤษ/ยุโรป)
}

// ---------- load index ----------
function loadIndex(lang /* 'th' | 'en' */) {
  if (CACHE[lang]) return CACHE[lang];

  const file = path.join(process.cwd(), 'public', 'city-index', `${lang}.json`);
  let arr = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = Array.isArray(raw) ? raw : (raw.items || []);
    arr = items
      .map(it => ({
        type: 'city',
        city_id: String(it.city_id || it.id || ''),
        label: String(it.label || it.name || '').trim(),
        _norm: normalize(it.label || it.name || '')
      }))
      .filter(x => x.city_id && x.label);
  } catch (_) {
    arr = [];
  }
  CACHE[lang] = arr;
  return arr;
}

// ---------- handler ----------
module.exports = function handler(req, res) {
  try {
    // map lang param จากหน้าเว็บ -> th|en
    const langParam = (qstr(req, 'lang', 'th-th') || 'th-th').toLowerCase();
    const lang = langParam.startsWith('en') ? 'en' : 'th';

    const q = qstr(req, 'q');
    const limit = Math.min(Math.max(qint(req, 'limit', 10), 1), MAX_LIMIT);

    if (!q) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).json({ ok: true, items: [] });
    }

    const idx = loadIndex(lang);
    const nq = normalize(q);

    const starts = [];
    const contains = [];
    for (const it of idx) {
      if (it._norm.startsWith(nq)) {
        starts.push(it);
        if (starts.length >= limit) break;
      }
    }
    if (starts.length < limit) {
      for (const it of idx) {
        if (!it._norm.startsWith(nq) && it._norm.includes(nq)) {
          contains.push(it);
          if (starts.length + contains.length >= limit) break;
        }
      }
    }

    const result = [...starts, ...contains]
      .slice(0, limit)
      .map(({ city_id, label }) => ({ type: 'city', city_id, label }));

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok: true, items: result });

  } catch (err) {
    console.error('city-suggest error:', err);
    return res.status(200).json({ ok: false, reason: 'internal_error', items: [] });
  }
};
