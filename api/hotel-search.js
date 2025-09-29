// /api/hotel-search.js — Vercel Serverless (CommonJS)
// โหมดใหม่: ถ้ามี cityId => เรียก Agoda Affiliate Lite API คืนรายการโรงแรมตามเมือง
// โหมดเดิม: ถ้ามี q       => ค้นหา autocomplete จากดัชนีภายใน (2.6M records)
//
// ส่งกลับให้ frontend ใช้แสดงการ์ด: { ok:true, items:[{ name, image, url, price, stars, reviewScore, currency, hotelId }] }

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ====== CONFIG ======
const MAX_LIMIT_Q = 20;      // limit สำหรับโหมด q (autocomplete)
const MAX_LIMIT_CITY = 30;   // limit สำหรับโหมด cityId (รายการการ์ด)
const AGODA_SITE_ID = process.env.AGODA_SITE_ID;
const AGODA_API_KEY = process.env.AGODA_API_KEY;

// ====== HELPERS (ทั่วไป) ======
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
const isNonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// ====== BUILD PARTNER URL (fallback/deeplink) ======
function buildPartnerUrlFromHotel({ hid, checkin, checkout, adults = 2, children = 0, rooms = 1, lang = 'th-th', currency = 'THB' }) {
  // ใช้พารามิเตอร์เดียวกับที่หน้า search.html ใช้
  const base = `https://www.agoda.com/${lang}/partners/partnersearch.aspx`;
  const sp = new URLSearchParams({
    cid: String(AGODA_SITE_ID || '1949420'),
    hid: String(hid || ''),
    checkin: checkin || '',
    checkout: checkout || '',
    rooms: String(rooms || 1),
    adults: String(adults || 2),
    children: String(children || 0),
    currency: currency || 'THB',
    utm_source: 'clickandgo',
    utm_medium: 'affiliate',
    noapp: '1',
    pcs: '1',
  });
  return `${base}?${sp.toString()}`;
}

// ====== โหมด cityId: เรียก Agoda Lite API ======
async function searchHotelsByCityLiteAPI({ cityId, checkin, checkout, rooms = 1, adults = 2, children = 0, limit = MAX_LIMIT_CITY, lang = 'th-th', currency = 'THB' }) {
  if (!AGODA_SITE_ID || !AGODA_API_KEY) {
    return { ok: false, reason: 'MISSING_AGODA_ENV', items: [] };
  }

  // หมายเหตุ: endpoint นี้อ้างอิงจากที่คุณใช้ทดสอบสำเร็จในโปรเจกต์
  const url = 'http://affiliateapi7643.agoda.com/affiliateservice/lt_v1';

  // บอดี้ตัวอย่างสำหรับ lite_v1 (อิงตามที่คุณเคยใช้)
  const body = {
    method: 'search',
    params: {
      cityId: String(cityId),
      checkIn: checkin || '',
      checkOut: checkout || '',
      rooms: Number(rooms || 1),
      adults: Number(adults || 2),
      children: Number(children || 0),
      language: lang || 'th-th',
      currency: currency || 'THB',
      limit: Number(limit || MAX_LIMIT_CITY),
    },
    id: 1,
  };

  // ใช้ fetch ของ Node 18 (Vercel runtime มีให้)
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // ตามที่คุณยืนยันว่าใช้ฟอร์แมตนี้แล้วผ่าน: site_id:api_key
      'Authorization': `${AGODA_SITE_ID}:${AGODA_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) return { ok: false, reason: 'AGODA_HTTP_' + r.status, items: [] };

  const j = await r.json();

  // โครงผลลัพธ์อาจต่างกันไปเล็กน้อย: ลองหลายทาง
  const raw =
    (Array.isArray(j?.result?.hotels) && j.result.hotels) ||
    (Array.isArray(j?.hotels) && j.hotels) ||
    (Array.isArray(j?.items) && j.items) ||
    (Array.isArray(j?.results) && j.results) ||
    [];

  const items = raw.map((h) => {
    // พยายามอ่านคีย์หลัก ๆ หลายแบบให้ครอบคลุม
    const hid = String(h.id || h.hotel_id || h.hid || '');
    const name = h.name || h.hotelName || h.title || h.label || '';
    const image = h.thumbnail || h.image || h.img || h.photo || '';
    const stars = h.stars ?? h.star ?? h.rating ?? 0;
    const reviewScore = h.reviewScore ?? h.score ?? h.review_score ?? null;
    const cur = h.currency || currency || 'THB';
    const price = h.price ?? h.minPrice ?? h.min_price ?? null;

    // ใช้ deeplink จาก API ถ้ามี ไม่งั้นสร้าง partner url เอง
    const url = h.deeplink || h.url || h.link || buildPartnerUrlFromHotel({
      hid,
      checkin,
      checkout,
      adults,
      children,
      rooms,
      lang,
      currency: cur,
    });

    return {
      // ฟิลด์เหล่านี้ตรงกับตัวอ่านใน search.html ของคุณ
      name,
      image,
      url,
      stars,
      reviewScore,
      currency: cur,
      price,
      hotelId: hid,
    };
  });

  return { ok: true, items };
}

// ====== โหมด q: autocomplete จากดัชนีภายใน (ของเดิม) ======
const CACHE = { th: null, en: null }; // เก็บผล parse แล้ว

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
      // JSON Lines: 1 บรรทัด = 1 object
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

  prepared = loadFromSingleJson(base);
  if (!prepared) prepared = loadFromShards(base);
  if (!Array.isArray(prepared)) prepared = [];

  CACHE[lang] = prepared;
  return prepared;
}

// ====== HANDLER ======
module.exports = async function handler(req, res) {
  try {
    // อ่านภาษา (สำหรับทั้งสองโหมด)
    const langParam = (qstr(req, 'lang', 'th') || 'th').toLowerCase();
    const lang = langParam.startsWith('en') ? 'en' : 'th';
    const langAgoda = lang === 'en' ? 'en-us' : 'th-th';

    // ---- โหมดใหม่: cityId ----
    const cityId = qstr(req, 'cityId', '');
    if (cityId) {
      const limit    = Math.min(Math.max(qint(req, 'limit', MAX_LIMIT_CITY), 1), MAX_LIMIT_CITY);
      const checkin  = qstr(req, 'checkin', '');   // รองรับตัวพิมพ์เล็ก
      const checkout = qstr(req, 'checkout', '');
      const rooms    = qint(req, 'rooms', 1);
      const adults   = qint(req, 'adults', 2);
      const children = qint(req, 'children', 0);

      const out = await searchHotelsByCityLiteAPI({
        cityId, checkin, checkout, rooms, adults, children,
        limit, lang: langAgoda, currency: 'THB',
      });

      res.setHeader('Cache-Control', 'no-store');
      if (!out.ok) {
        return res.status(200).json({ ok: false, reason: out.reason || 'city_search_failed', items: [] });
      }
      return res.status(200).json({ ok: true, items: out.items.slice(0, MAX_LIMIT_CITY) });
    }

    // ---- โหมดเดิม: q (autocomplete โรงแรม) ----
    const q = qstr(req, 'q');
    const limitQ = Math.min(Math.max(qint(req, 'limit', 10), 1), MAX_LIMIT_Q);

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
};
