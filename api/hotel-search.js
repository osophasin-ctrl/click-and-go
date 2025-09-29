// /api/hotel-search.js — Agoda search (Serverless / CommonJS)
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
