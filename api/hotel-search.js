// /api/hotel-search.js — Vercel Serverless (CommonJS)
// โหมดใหม่: รองรับทั้ง
//   (A) ค้นหาด้วย cityId  → ดึงลิสต์โรงแรมตามเมือง (Thai-first)
//   (B) ค้นหาด้วย q       → ค้นชื่อโรงแรมจากดัชนีภายใน (โหมดเดิม)
//
// ส่งกลับรูปแบบสอดคล้องหน้าเว็บ: { ok:true, items:[ ... ] }

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_LIMIT = 30; // ต้องการ 30 การ์ดต่อหน้า
const CACHE = { th: null, en: null };

const AGODA_SITE_ID = process.env.AGODA_SITE_ID || '';
const AGODA_API_KEY = process.env.AGODA_API_KEY || '';
const CITY_SEARCH_URL = process.env.CITY_SEARCH_URL || ''; // ถ้ามี backend Python ให้ใส่ไว้

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
    .replace(/[\u0300-\u036f]/g, '');
}
const isNonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// ----------- loaders (โหมด q เดิม) -----------
function loadFromSingleJson(langDir) {
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
  const shardDir = path.join(langDir, 'shard');
  if (!fs.existsSync(shardDir)) return null;

  const files = fs.readdirSync(shardDir)
    .filter(f => /\.jsonl\.gz$/i.test(f))
    .sort();

  const out = [];
  for (const f of files) {
    try {
      const gz = fs.readFileSync(path.join(shardDir, f));
      const txt = zlib.gunzipSync(gz).toString('utf8');
      for (const line of txt.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        const hotel_id = String(obj.hotel_id || obj.id || obj.hid || '');
        const label = String(obj.label || obj.name || '');
        if (!hotel_id || !label) continue;
        out.push({ type: 'hotel', hotel_id, label, _norm: normalize(label) });
      }
    } catch {}
  }
  return out;
}

function loadIndex(lang) {
  if (CACHE[lang]) return CACHE[lang];
  const base = path.join(process.cwd(), 'public', 'hotel-index', lang);
  let prepared = loadFromSingleJson(base);
  if (!prepared) prepared = loadFromShards(base);
  if (!Array.isArray(prepared)) prepared = [];
  CACHE[lang] = prepared;
  return prepared;
}

// ---------- mapping สำหรับผลลัพธ์โรงแรม (ให้เข้ากับหน้าเว็บ) ----------
function mapHotelItem(h) {
  // พยายามรองรับหลายชื่อคีย์จาก vendor/Agoda
  const get = (obj, keys, def = '') => {
    for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') return obj[k];
    return def;
  };
  const id   = String(get(h, ['id','hotelId','hotel_id','hid','agodaId'], ''));
  const name = String(get(h, ['name','hotelName','title','label'], ''));
  const img  = String(get(h, ['thumbnail','thumbnail_url','image','img','photo','imageUrl','imageURL'], ''));
  const url  = String(get(h, ['url','link','deeplink','deeplinkUrl','deeplinkURL'], ''));
  const stars= get(h, ['stars','star','rating','starRating','StarRating'], 0);
  const score= get(h, ['reviewScore','score','review_score','ReviewScore'], null);
  const cur  = String(get(h, ['currency','cur'], 'THB'));
  const price= get(h, ['price','minPrice','min_price','fromPrice','Price'], null);

  return {
    type: 'hotel',
    id,
    hotelId: id,
    name,
    image: img,
    url,
    stars,
    reviewScore: score,
    currency: cur || 'THB',
    price: (price != null && !isNaN(+price)) ? +price : null
  };
}

// ---------- ดึงโรงแรมตาม cityId ----------
async function fetchFromPythonBackend(params) {
  // เรียก backend ของคุณ หากตั้ง CITY_SEARCH_URL ไว้
  const usp = new URLSearchParams(params);
  const target = `${CITY_SEARCH_URL}?${usp.toString()}`;
  const r = await fetch(target, { headers: { 'cache-control': 'no-store' }});
  if (!r.ok) return { ok:false, reason:'PY_HTTP_'+r.status, items:[] };
  const j = await r.json();
  let raw =
    (Array.isArray(j?.items)   && j.items)   ||
    (Array.isArray(j?.results) && j.results) ||
    (Array.isArray(j?.hotels)  && j.hotels)  ||
    (Array.isArray(j?.data?.items)   && j.data.items) ||
    (Array.isArray(j?.data?.results) && j.data.results) ||
    (Array.isArray(j?.data?.hotels)  && j.data.hotels)  ||
    [];
  return { ok:true, items: raw.map(mapHotelItem) };
}

async function fetchFromAgodaLite(params) {
  // เรียก Agoda Lite API โดยตรง (ตามที่คุณทดสอบไว้)
  if (!AGODA_SITE_ID || !AGODA_API_KEY) return { ok:false, reason:'MISSING_AGODA_ENV', items:[] };

  const url = 'http://affiliateapi7643.agoda.com/affiliateservice/lt_v1';
  const body = {
    method: 'search',
    params: {
      cityId: String(params.cityId),
      checkIn: params.checkin || '',
      checkOut: params.checkout || '',
      rooms: Number(params.rooms || 1),
      adults: Number(params.adults || 2),
      children: Number(params.children || 0),
      language: params.lang || 'th-th',
      currency: params.currency || 'THB',
      limit: Number(params.limit || 30)
    },
    id: 1
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `${AGODA_SITE_ID}:${AGODA_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) return { ok:false, reason:'AGODA_HTTP_'+r.status, items:[] };

  const j = await r.json();
  const raw =
    (Array.isArray(j?.result?.hotels) && j.result.hotels) ||
    (Array.isArray(j?.hotels) && j.hotels) ||
    (Array.isArray(j?.items)  && j.items)  ||
    (Array.isArray(j?.results)&& j.results)||
    [];
  return { ok:true, items: raw.map(mapHotelItem) };
}

// ---------- handler ----------
module.exports = async function handler(req, res) {
  try {
    const langParam = (qstr(req, 'lang', 'th-th') || 'th-th').toLowerCase();
    // สำหรับดัชนีภายใน (โหมด q) ให้ลดรูปเป็น th/en
    const idxLang = langParam.includes('en') ? 'en' : 'th';

    const limit = Math.min(Math.max(qint(req, 'limit', 30), 1), MAX_LIMIT);

    // โหมด A: มี cityId -> ค้นตามเมือง (ใช้ Python backend ถ้ามี, ไม่มีก็ Agoda Lite)
    const cityId = qstr(req, 'cityId', '');
    if (cityId) {
      const params = {
        cityId,
        checkin:  qstr(req,'checkin',''),
        checkout: qstr(req,'checkout',''),
        rooms:    qstr(req,'rooms','1'),
        adults:   qstr(req,'adults','2'),
        children: qstr(req,'children','0'),
        lang:     langParam,
        currency: qstr(req,'currency','THB'),
        limit:    String(limit)
      };

      let out = { ok:false, items:[], reason:'NO_SOURCE' };
      if (CITY_SEARCH_URL) {
        try { out = await fetchFromPythonBackend(params); } catch {}
      }
      if (!out.ok) {
        try { out = await fetchFromAgodaLite(params); } catch {}
      }

      if (!out.ok) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ ok:false, reason: out.reason || 'city_search_failed', items:[] });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok:true, items: out.items.slice(0, limit) });
    }

    // โหมด B: ไม่มี cityId แต่มี q -> ค้นชื่อโรงแรมจากดัชนีภายใน (เดิม)
    const q = qstr(req, 'q');
    if (!q || q.length < 1) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).json({ ok: true, items: [] });
    }

    const idx = loadIndex(idxLang);
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
