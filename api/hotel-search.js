// /api/hotel-search.js
// ค้นหาโรงแรมจากดัชนีภายในโปรเจ็กต์ (ไม่ยิง Agoda ตรงๆ)
// รองรับ lang=th|en และ limit

const fs = require('fs');
const path = require('path');

const CACHE = { th: null, en: null };
const MAX_LIMIT = 20;

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
    .replace(/[\u0300-\u036f]/g, ''); // strip accents (กันเคสภาษาอื่น)
}

function loadIndex(lang) {
  if (CACHE[lang]) return CACHE[lang];

  const p = path.join(process.cwd(), 'public', 'hotel-index', `${lang}.json`);
  const raw = fs.readFileSync(p, 'utf8');
  const json = JSON.parse(raw);

  // คาดว่าโครงสร้างเป็น { items: [{ hotel_id, label }, ...] } หรือ array ตรง ๆ
  const items = Array.isArray(json) ? json : (json.items || []);

  // สร้างฟิลด์ค้นหาไว้ล่วงหน้า เพื่อให้ค้นหาเร็ว
  const prepared = items.map(it => ({
    type: 'hotel',
    hotel_id: String(it.hotel_id || it.id || it.hid || ''),
    label: String(it.label || it.name || ''),
    _norm: normalize(it.label || it.name || '')
  })).filter(x => x.hotel_id && x.label);

  CACHE[lang] = prepared;
  return prepared;
}

export default function handler(req, res) {
  try {
    const lang = (qstr(req, 'lang', 'th') || 'th').toLowerCase() === 'en' ? 'en' : 'th';
    const q = qstr(req, 'q');
    const limit = Math.min(Math.max(qint(req, 'limit', 10), 1), MAX_LIMIT);

    if (!q || q.length < 1) {
      return res.status(200).json({ ok: true, items: [] });
    }

    const idx = loadIndex(lang);
    const nq = normalize(q);

    // กลยุทธ์ค้นหา: เริ่มจาก prefix ก่อน ไม่พอค่อยรวม contains
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
      .map(({ hotel_id, label }) => ({ type: 'hotel', hotel_id, label }));

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok: true, items: result });
  } catch (err) {
    console.error('hotel-search error:', err);
    return res.status(200).json({ ok: false, reason: 'internal_error' });
  }
}
