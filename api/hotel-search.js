// /api/hotel-search.js — Vercel Serverless (CommonJS)
// ค้นหาโรงแรมจากดัชนีภายในโปรเจ็กต์
// รองรับ 2 รูปแบบ:
//   1) public/hotel-index/{lang}.json           (array หรือ {items:[]})
//   2) public/hotel-index/{lang}/shard/*.jsonl.gz (JSON Lines บีบอัด gzip)
// ส่งกลับ: { ok:true, items:[ {type:'hotel', hotel_id, label} ] }

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_LIMIT = 20;
const CACHE = { th: null, en: null }; // เก็บผลที่ parse แล้ว

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
    .replace(/[\u0300-\u036f]/g, ''); // ตัดวรรณยุกต์/accents
}

// ---------- loaders ----------
function loadFromSingleJson(langDir) {
  // public/hotel-index/{lang}.json
  const file = path.join(langDir, '..', `${path.basename(langDir)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.items || []);
    return arr
      .map(it => ({
        type: 'hotel',
        hotel_id: String(it.hotel_id || it.id || it.hid || ''),
        label: String(it.label || it.name || ''),
        _norm: normalize(it.label || it.name || '')
      }))
      .filter(x => x.hotel_id && x.label);
  } catch {
    return null;
  }
}

function loadFromShards(langDir) {
  // public/hotel-index/{lang}/shard/*.jsonl.gz
  const shardDir = path.join(langDir, 'shard');
  if (!fs.existsSync(shardDir)) return null;

  const files = fs
    .readdirSync(shardDir)
    .filter(f => /\.jsonl\.gz$/i.test(f))
    .sort(); // ตามชื่อไฟล์

  const out = [];
  for (const f of files) {
    try {
      const gz = fs.readFileSync(path.join(shardDir, f));
      const txt = zlib.gunzipSync(gz).toString('utf8');
      // JSON Lines: หนึ่งบรรทัด = หนึ่ง JSON object
      for (const line of txt.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        const hotel_id = String(obj.hotel_id || obj.id || obj.hid || '');
        const label = String(obj.label || obj.name || '');
        if (!hotel_id || !label) continue;
        out.push({ type: 'hotel', hotel_id, label, _norm: normalize(label) });
      }
    } catch {
      // ข้าม shard ที่อ่านพัง
    }
  }
  return out;
}

function loadIndex(lang) {
  if (CACHE[lang]) return CACHE[lang];

  const base = path.join(process.cwd(), 'public', 'hotel-index', lang);
  let prepared = null;

  // 1) ลองอ่านไฟล์รวมก่อน
  prepared = loadFromSingleJson(base);
  // 2) ถ้าไม่มี ให้ลองอ่านจาก shards
  if (!prepared) prepared = loadFromShards(base);

  // 3) ถ้ายังไม่ได้ ให้เป็นอาเรย์ว่าง
  if (!Array.isArray(prepared)) prepared = [];

  CACHE[lang] = prepared;
  return prepared;
}

// ---------- handler ----------
module.exports = function handler(req, res) {
  try {
    const langParam = (qstr(req, 'lang', 'th') || 'th').toLowerCase();
    const lang = langParam === 'en' ? 'en' : 'th';

    const q = qstr(req, 'q');
    const limit = Math.min(Math.max(qint(req, 'limit', 10), 1), MAX_LIMIT);

    if (!q || q.length < 1) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).json({ ok: true, items: [] });
    }

    const idx = loadIndex(lang);
    const nq = normalize(q);

    // ค้นหา: เริ่ม prefix -> ตามด้วย contains
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
};
