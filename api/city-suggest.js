// /api/city-suggest.js — Vercel Serverless (CommonJS)
// Autocomplete เมืองสำหรับหน้า index
// รองรับ lang: th-th|th และ en-us|en
// อ่านดัชนีจาก: public/city-index/th.json, public/city-index/en.json
// (รองรับแบบ shard *.jsonl.gz ด้วย ถ้ามี)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CACHE = { th: null, en: null };
const MAX_LIMIT = 30;

function qstr(req, key, def = '') {
  const v = (req.query && req.query[key]) || def;
  return (v == null ? '' : String(v)).trim();
}
function qint(req, key, def = 0) {
  const n = parseInt(qstr(req, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}
function normalizeLang(s) {
  s = (s || '').toLowerCase();
  if (s.startsWith('th')) return 'th';
  if (s.startsWith('en')) return 'en';
  return 'th';
}
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ''); // ตัดวรรณยุกต์/ไดอะคริติก
}

// ---------- โหลดดัชนีเมือง ----------
function loadFromSingleJson(baseDir, lang) {
  // คาดหวังไฟล์: public/city-index/th.json หรือ en.json
  const p1 = path.join(baseDir, `${lang}.json`);
  if (!fs.existsSync(p1)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p1, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.items || []);
    return arr
      .map(it => {
        // พยายามจับ field ที่เป็นไปได้หลายแบบ
        const id =
          it.city_id ?? it.cityId ?? it.id ?? it.cid ?? it._id ?? null;
        const labelTh =
          it.label_th ?? it.name_th ?? it.th ?? it.labelTH ?? null;
        const labelEn =
          it.label_en ?? it.name_en ?? it.en ?? it.labelEN ?? null;

        const label =
          lang === 'th'
            ? (labelTh || it.label || it.name || labelEn)
            : (labelEn || it.label || it.name || labelTh);

        if (!id || !label) return null;

        const country =
          it.country ?? it.country_name ?? it.country_en ?? it.cc ?? '';

        return {
          type: 'city',
          city_id: String(id),
          label: String(label),
          country: String(country || ''),
          _norm: normalize(label)
        };
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}

function loadFromShards(baseDir, lang) {
  // เผื่อมีเก็บเป็น shard: public/city-index/th/shard/*.jsonl.gz
  const shardDir = path.join(baseDir, lang, 'shard');
  if (!fs.existsSync(shardDir)) return null;

  const files = fs
    .readdirSync(shardDir)
    .filter(f => /\.jsonl\.gz$/i.test(f))
    .sort();

  const out = [];
  for (const f of files) {
    try {
      const gz = fs.readFileSync(path.join(shardDir, f));
      const txt = zlib.gunzipSync(gz).toString('utf8');
      for (const line of txt.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let it;
        try { it = JSON.parse(line); } catch { continue; }

        const id =
          it.city_id ?? it.cityId ?? it.id ?? it.cid ?? it._id ?? null;
        const labelTh =
          it.label_th ?? it.name_th ?? it.th ?? it.labelTH ?? null;
        const labelEn =
          it.label_en ?? it.name_en ?? it.en ?? it.labelEN ?? null;

        const label =
          lang === 'th'
            ? (labelTh || it.label || it.name || labelEn)
            : (labelEn || it.label || it.name || labelTh);

        if (!id || !label) continue;

        const country =
          it.country ?? it.country_name ?? it.country_en ?? it.cc ?? '';

        out.push({
          type: 'city',
          city_id: String(id),
          label: String(label),
          country: String(country || ''),
          _norm: normalize(label)
        });
      }
    } catch {
      // ignore shard error
    }
  }
  return out;
}

function loadIndex(lang) {
  if (CACHE[lang]) return CACHE[lang];
  const base = path.join(process.cwd(), 'public', 'city-index');

  let prepared = loadFromSingleJson(base, lang);
  if (!prepared) prepared = loadFromShards(base, lang);
  if (!Array.isArray(prepared)) prepared = [];

  CACHE[lang] = prepared;
  return prepared;
}

// ---------- handler ----------
module.exports = async function handler(req, res) {
  try {
    const q = qstr(req, 'q');
    const limit = Math.min(Math.max(qint(req, 'limit', 10), 1), MAX_LIMIT);
    const lang = normalizeLang(qstr(req, 'lang', 'th-th'));

    if (!q || q.length < 1) {
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
      .map(({ city_id, label, country }) => ({
        type: 'city',
        city_id,
        label,
        country
      }));

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok: true, items: result });
  } catch (err) {
    console.error('city-suggest error:', err);
    return res.status(200).json({ ok: false, reason: 'internal_error', items: [] });
  }
};
