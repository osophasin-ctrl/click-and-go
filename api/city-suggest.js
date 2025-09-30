// /api/city-suggest.js — Autocomplete เมือง
// รองรับไฟล์ดัชนี 2 รูปแบบ (วางตรง public เลย หรือในโฟลเดอร์ย่อย):
//   public/city-index-th.json, public/city-index-en.json
//   public/city-index/th.json,   public/city-index/en.json

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CACHE = { th: null, en: null };
const MAX_LIMIT = 30;

const qstr = (req, k, d='') => {
  const v = (req.query && req.query[k]) || d;
  return (v == null ? '' : String(v)).trim();
};
const qint = (req, k, d=0) => {
  const n = parseInt(qstr(req, k, String(d)), 10);
  return Number.isFinite(n) ? n : d;
};
const normLang = s => (String(s||'').toLowerCase().startsWith('en') ? 'en' : 'th');
const norm = s => String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');

// ---------- loader ----------
function tryLoadJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw;
  } catch {
    return null;
  }
}

function fromSingleJson(baseDir, lang) {
  // รองรับชื่อไฟล์ทั้งสองแบบ
  const candidates = [
    path.join(baseDir, `city-index-${lang}.json`),   // public/city-index-th.json
    path.join(baseDir, 'city-index', `${lang}.json`) // public/city-index/th.json
  ];
  for (const f of candidates) {
    const raw = tryLoadJson(f);
    if (!raw) continue;
    const arr = Array.isArray(raw) ? raw : (raw.items || []);
    const out = arr.map(it => {
      const id = it.city_id ?? it.cityId ?? it.id ?? it.cid ?? it._id;
      const label = it.label ?? it[`label_${lang}`] ?? it.name ?? it[`name_${lang}`];
      const country = it.country ?? it.country_name ?? it.country_en ?? '';
      if (!id || !label) return null;
      return { type:'city', city_id:String(id), label:String(label), country:String(country||''), _norm:norm(label) };
    }).filter(Boolean);
    if (out.length) return out;
  }
  return null;
}

function fromShards(baseDir, lang) {
  // เผื่อในอนาคตใช้ shard แบบ jsonl.gz: public/city-index/<lang>/shard/*.jsonl.gz
  const shardDir = path.join(baseDir, 'city-index', lang, 'shard');
  if (!fs.existsSync(shardDir)) return null;
  const files = fs.readdirSync(shardDir).filter(f => /\.jsonl\.gz$/i.test(f)).sort();
  const out = [];
  for (const f of files) {
    try {
      const buf = fs.readFileSync(path.join(shardDir, f));
      const txt = zlib.gunzipSync(buf).toString('utf8');
      for (const line of txt.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let it; try { it = JSON.parse(line); } catch { continue; }
        const id = it.city_id ?? it.cityId ?? it.id ?? it.cid ?? it._id;
        const label = it.label ?? it[`label_${lang}`] ?? it.name ?? it[`name_${lang}`];
        const country = it.country ?? it.country_name ?? it.country_en ?? '';
        if (!id || !label) continue;
        out.push({ type:'city', city_id:String(id), label:String(label), country:String(country||''), _norm:norm(label) });
      }
    } catch {}
  }
  return out.length ? out : null;
}

function loadIndex(lang) {
  if (CACHE[lang]) return CACHE[lang];
  const base = path.join(process.cwd(), 'public');
  let data = fromSingleJson(base, lang);
  if (!data) data = fromShards(base, lang);
  CACHE[lang] = Array.isArray(data) ? data : [];
  return CACHE[lang];
}

// ---------- handler ----------
module.exports = async function handler(req, res) {
  try {
    const q = qstr(req, 'q');
    const limit = Math.min(Math.max(qint(req, 'limit', 10), 1), MAX_LIMIT);
    const lang = normLang(qstr(req, 'lang', 'th-th'));

    if (!q) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).json({ ok:true, items:[] });
    }

    const idx = loadIndex(lang);
    const nq = norm(q);

    const starts = [], contains = [];
    for (const it of idx) {
      if (it._norm.startsWith(nq)) { starts.push(it); if (starts.length >= limit) break; }
    }
    if (starts.length < limit) {
      for (const it of idx) {
        if (!it._norm.startsWith(nq) && it._norm.includes(nq)) {
          contains.push(it);
          if (starts.length + contains.length >= limit) break;
        }
      }
    }

    const result = [...starts, ...contains].slice(0, limit).map(({city_id, label, country}) => ({type:'city', city_id, label, country}));
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok:true, items: result });
  } catch (e) {
    console.error('city-suggest error:', e);
    return res.status(200).json({ ok:false, reason:'internal_error', items:[] });
  }
};
