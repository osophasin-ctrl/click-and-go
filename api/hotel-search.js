// /api/hotel-search.js — Vercel Serverless (CommonJS)
// ตรงสเปก Agoda Long Tail Search API V2 (lt_v1)
// - City Search:  criteria.cityId, dates, additional.*
// - Hotel List:   criteria.hotelId = [ ... ]
// Header ต้องมี: Authorization: "<siteId>:<apiKey>", Accept-Encoding: "gzip,deflate"
// เรายังคงโหมด q สำหรับ autocomplete จากดัชนีภายในไว้เหมือนเดิม

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_LIMIT_Q = 20;
const MAX_LIMIT_CITY = 30;
const ENDPOINT = 'http://affiliateapi7643.agoda.com/affiliateservice/lt_v1';

const AGODA_SITE_ID = process.env.AGODA_SITE_ID; // ตัวเลข siteId ของคุณ
const AGODA_API_KEY = process.env.AGODA_API_KEY; // apiKey ของคุณ

// ---------- helpers ----------
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

// ---------- map Agoda result -> frontend card ----------
function mapLongTailResultItem(it) {
  // ตาม Response Schema ของ Long Tail V2
  const hotelId = String(it.hotelId ?? it.id ?? '');
  const name = it.hotelName || it.name || '';
  const image = it.imageURL || it.thumbnail || '';
  const url = it.landingURL || it.deeplink || it.url || '#';
  const price = it.dailyRate ?? it.price ?? null;
  const currency = it.currency || 'THB';
  const stars = it.starRating ?? it.stars ?? 0;
  const reviewScore = it.reviewScore ?? it.score ?? null;

  return {
    name,
    image,
    url,
    price,
    currency,
    stars,
    reviewScore,
    hotelId,
  };
}

// ---------- call Agoda Long Tail V2 ----------
async function callAgodaLongTail(criteria) {
  if (!AGODA_SITE_ID || !AGODA_API_KEY) {
    return { ok: false, reason: 'MISSING_AGODA_ENV', items: [] };
  }

  // ตรงสเปก: body ต้องเป็น { criteria: {...} }
  // (หลาย partner ต้องส่ง siteId/apiKey ใน header ให้ "ตรงกัน" กับที่ลงทะเบียน)
  const payload = { criteria };

  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip,deflate',
      'Authorization': `${AGODA_SITE_ID}:${AGODA_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (!r.ok) {
    const snippet = (text || '').slice(0, 400);
    return { ok: false, reason: `AGODA_HTTP_${r.status} ${snippet}`, items: [] };
  }

  // สเปกระบุ result-key เป็น "results" (กรณี error จะเป็น {error:{id,message}})
  if (json?.error) {
    return { ok: false, reason: `AGODA_ERROR_${json.error.id} ${json.error.message || ''}`.trim(), items: [] };
  }

  const raw = Array.isArray(json?.results) ? json.results : [];
  const items = raw.map(mapLongTailResultItem);
  return { ok: true, items };
}

// ---------- internal index for autocomplete (โหมด q เดิม) ----------
const CACHE = { th: null, en: null };

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
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        const hotel_id = String(obj.hotel_id || obj.id || obj.hid || '');
        const label = String(obj.label || obj.name || '');
        if (!hotel_id || !label) continue;
        out.push({ type: 'hotel', hotel_id, label, _norm: normalize(label) });
      }
    } catch { /* ignore shard error */ }
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

// ---------- handler ----------
module.exports = async function handler(req, res) {
  try {
    const langParam = (qstr(req, 'lang', 'th-th') || 'th-th').toLowerCase();
    const langAgoda = langParam.startsWith('en') ? 'en-us' : 'th-th';

    // ===== โหมด City Search (ตามสเปก V2) =====
    const cityId = qstr(req, 'cityId') || qstr(req, 'cityid');
    if (cityId) {
      const checkIn  = qstr(req, 'checkin');
      const checkOut = qstr(req, 'checkout');
      const adults   = qint(req, 'adults', 2);
      const children = qint(req, 'children', 0);
      const rooms    = qint(req, 'rooms', 1);
      const limit    = Math.min(Math.max(qint(req, 'limit', MAX_LIMIT_CITY), 1), 30);

      // mapping ตัวกรองเพิ่มเติมถ้าฝั่งหน้าเว็บส่งมา
      const minimumStarRating   = qstr(req, 'starsMin') ? Number(qstr(req, 'starsMin')) : 0;
      const minimumReviewScore  = qstr(req, 'scoreMin') ? Number(qstr(req, 'scoreMin')) : 0;
      const priceMin            = qstr(req, 'priceMin') ? Number(qstr(req, 'priceMin')) : 0;
      const priceMax            = qstr(req, 'priceMax') ? Number(qstr(req, 'priceMax')) : 100000;

      const criteria = {
        checkInDate:  checkIn,
        checkOutDate: checkOut,
        cityId: Number(cityId),
        additional: {
          language: langAgoda,
          currency: 'THB',
          maxResult: limit,                 // (1–30)
          sortBy: 'Recommended',
          discountOnly: false,
          minimumStarRating,
          minimumReviewScore,
          dailyRate: { minimum: priceMin, maximum: priceMax },
          occupancy: { numberOfAdult: adults, numberOfChildren: children },
          // หมายเหตุ: rooms ไม่อยู่ในสเปก Long Tail V2 → ไม่ส่ง
        }
      };

      const out = await callAgodaLongTail(criteria);
      res.setHeader('Cache-Control', 'no-store');
      if (!out.ok) return res.status(200).json({ ok: false, reason: out.reason, items: [] });
      return res.status(200).json({ ok: true, items: out.items });
    }

    // ===== โหมด Hotel List Search (ตามสเปก V2) =====
    const hotelIdParam = qstr(req, 'hotelId') || qstr(req, 'hid') || '';
    if (hotelIdParam) {
      const checkIn  = qstr(req, 'checkin');
      const checkOut = qstr(req, 'checkout');
      const adults   = qint(req, 'adults', 2);
      const children = qint(req, 'children', 0);
      const ids = hotelIdParam
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(n => Number(n))
        .filter(n => Number.isFinite(n));

      const criteria = {
        checkInDate:  checkIn,
        checkOutDate: checkOut,
        hotelId: ids,
        additional: {
          language: langAgoda,
          currency: 'THB',
          discountOnly: false,
          occupancy: { numberOfAdult: adults, numberOfChildren: children },
        }
      };

      const out = await callAgodaLongTail(criteria);
      res.setHeader('Cache-Control', 'no-store');
      if (!out.ok) return res.status(200).json({ ok: false, reason: out.reason, items: [] });
      return res.status(200).json({ ok: true, items: out.items });
    }

    // ===== โหมด q — autocomplete (ของเดิม) =====
    const q = qstr(req, 'q');
    const limitQ = Math.min(Math.max(qint(req, 'limit', 10), 1), MAX_LIMIT_Q);

    if (!q || q.length < 1) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      return res.status(200).json({ ok: true, items: [] });
    }

    const lang = langParam.startsWith('en') ? 'en' : 'th';
    const idx = loadIndex(lang);
    const nq = normalize(q);

    const starts = [];
    const contains = [];
    for (const it of idx) {
      if (it._norm.startsWith(nq)) {
        starts.push(it);
        if (starts.length >= limitQ) break;
      }
    }
    if (starts.length < limitQ) {
      for (const it of idx) {
        if (!it._norm.startsWith(nq) && it._norm.includes(nq)) {
          contains.push(it);
          if (starts.length + contains.length >= limitQ) break;
        }
      }
    }

    const result = [...starts, ...contains]
      .slice(0, limitQ)
      .map(({ hotel_id, label }) => ({ type: 'hotel', hotel_id, label }));

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok: true, items: result });

  } catch (err) {
    console.error('hotel-search error:', err);
    return res.status(200).json({ ok: false, reason: 'internal_error', items: [] });
  }
};/ /api/hotel-search.js — Agoda search (Serverless / CommonJS)
// เป้าหมายรอบนี้: ให้คืนผลลัพธ์ได้ "สูงสุด 30 โรงแรม"
// - อ่าน ?limit= (ดีฟอลต์ 30) และบังคับ MAX 30
// - ตอนยิงไป Agoda ส่ง pageSize/limit/page_size ให้ครบ
// - หลังรับผลมา slice(limit) อีกชั้น เผื่อฝั่งโน้นไม่สนใจพารามิเตอร์

const fetch = require('node-fetch');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 30;

function qstr(req, key, def = '') {
  const v = (req.query && req.query[key]) ?? def;
  return v == null ? '' : String(v).trim();
}
function qint(req, key, def = 0) {
  const n = parseInt(qstr(req, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}

function buildAgodaUrl(opts) {
  // NOTE: ไม่เปลี่ยนรูปแบบพื้นฐานของคุณ แค่เพิ่มตัวควบคุมจำนวนรายการ
  // ถ้าคุณใช้ endpoint เฉพาะของ Agoda อยู่แล้ว ให้แทนที่ baseUrl ให้ตรงของคุณ
  const baseUrl = process.env.AGODA_SEARCH_ENDPOINT ||
    'https://affiliateapi.agoda.com/affiliateservice/lt_v2/Hotel/Search';

  const sp = new URLSearchParams();

  // ปกติระบบคุณรองรับ 2 โหมด: cityId หรือ hotelId
  if (opts.hotelId) sp.set('hotelId', String(opts.hotelId));
  if (opts.cityId)  sp.set('cityId',  String(opts.cityId));

  if (opts.checkin)  sp.set('checkin',  opts.checkin);
  if (opts.checkout) sp.set('checkout', opts.checkout);
  if (opts.rooms)    sp.set('rooms',    String(opts.rooms));
  if (opts.adults)   sp.set('adults',   String(opts.adults));
  if (opts.children) sp.set('children', String(opts.children));
  if (opts.lang)     sp.set('language', opts.lang);
  if (opts.currency) sp.set('currency', opts.currency);

  // ใส่ตัวควบคุมจำนวนผลลัพธ์หลายชื่อ (กันเหนียว)
  sp.set('limit',     String(opts.limit));
  sp.set('pageSize',  String(opts.limit));
  sp.set('page_size', String(opts.limit));
  sp.set('pagesize',  String(opts.limit));

  // ใส่ Affiliate/Partner meta ที่คุณใช้อยู่
  if (process.env.AGODA_PARTNER_ID) sp.set('cid', process.env.AGODA_PARTNER_ID);

  return `${baseUrl}?${sp.toString()}`;
}

function mapAgodaItem(h) {
  // ปรับ map ให้เข้ากับที่หน้าเว็บอ่านได้
  return {
    name:        h.name || h.hotelName || h.title || '',
    image:       h.image || h.thumbnailUrl || h.img || '',
    url:         h.url || h.deeplink || h.link || '',
    price:       Number(h.price || h.minPrice || h.fromPrice || h.min_price || 0) || null,
    currency:    h.currency || h.cur || 'THB',
    stars:       h.stars ?? h.star ?? h.rating ?? 0,
    reviewScore: h.reviewScore ?? h.score ?? h.review_score ?? null,
    hotelId:     String(h.hotelId || h.id || h.hotel_id || '')
  };
}

module.exports = async (req, res) => {
  try {
    const cityId   = qstr(req, 'cityId');
    const hotelId  = qstr(req, 'hotelId') || qstr(req, 'hid');
    const checkin  = qstr(req, 'checkin');
    const checkout = qstr(req, 'checkout');
    const rooms    = qint(req, 'rooms', 1);
    const adults   = qint(req, 'adults', 2);
    const children = qint(req, 'children', 0);
    const lang     = (qstr(req, 'lang', 'th-th') || 'th-th').toLowerCase();
    const currency = qstr(req, 'currency', 'THB');

    // จุดสำคัญ: enforce limit สูงสุด 30
    const rawLimit = qint(req, 'limit', DEFAULT_LIMIT);
    const limit    = Math.min(Math.max(rawLimit, 1), MAX_LIMIT);

    if (!cityId && !hotelId) {
      return res.status(400).json({ ok: false, reason: 'MISSING_CITY_OR_HOTEL', items: [] });
    }

    const url = buildAgodaUrl({
      cityId, hotelId, checkin, checkout, rooms, adults, children, lang, currency, limit
    });

    // เรียก Agoda
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        // ถ้าคุณต้องส่งคีย์ใน header เช่น 'Api-Key': process.env.AGODA_API_KEY
        ...(process.env.AGODA_API_KEY ? { 'Api-Key': process.env.AGODA_API_KEY } : {})
      },
      timeout: 20000
    });

    if (!r.ok) {
      return res.status(200).json({ ok: false, reason: `AGODA_HTTP_${r.status}`, items: [] });
    }

    const json = await r.json();

    // โครงสร้างผลลัพธ์ของคุณอาจเป็น items / results / hotels
    let arr = json.items || json.results || json.hotels || [];
    if (!Array.isArray(arr)) arr = [];

    // บังคับตัดให้ไม่เกิน limit
    const items = arr.slice(0, limit).map(mapAgodaItem);

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error('hotel-search error:', err);
    return res.status(200).json({ ok: false, reason: 'AGODA_FETCH_FAILED', items: [] });
  }
};
