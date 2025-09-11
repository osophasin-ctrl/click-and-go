// /api/search.js
// Agoda Affiliate Lite API bridge for Click & Go
// Reads env: AGODA_API_KEY, AGODA_CID
// Fallback to mock data if API fails.

export default async function handler(req, res) {
  try {
    const {
      q = '',
      checkin,
      checkout,
      rooms = '1',
      adults = '2',
      children = '0',
      lang = 'en-us',
      currency = 'THB',
      max = '20',
      cityId = '',           // แนะนำส่ง cityId (เช่น 9395 = Bangkok)
      debug = '0'
    } = req.query || {};

    // --- ตรวจ ENV ---
    const API_KEY = process.env.AGODA_API_KEY || '';
    const CID = process.env.AGODA_CID || '';
    const hasKey = API_KEY && CID;

    // --- สร้าง criteria ส่งเข้า Agoda ---
    // เอกสาร: Affiliate Lite API v2.0 (lt_v1)
    // endpoint: http://affiliateapi7643.agoda.com/affiliateservice/lt_v1
    const OCC = {
      numberOfAdult: toInt(adults, 2),
      numberOfChildren: toInt(children, 0)
    };

    const criteria = {
      additional: {
        currency: String(currency || 'THB').toUpperCase(),
        language: String(lang || 'en-us').toLowerCase(),
        maxResult: toInt(max, 20),
        discountOnly: false,
        minimumStarRating: 0,
        minimumReviewScore: 0,
        sortBy: 'PriceAsc',
        occupancy: OCC
      },
      checkInDate: normalizeDate(checkin),
      checkOutDate: normalizeDate(checkout)
    };

    if (cityId) {
      criteria.cityId = toInt(cityId);
    } else if (q) {
      // ถ้าไม่มี cityId ให้ใช้ keyword
      criteria.keyword = String(q).trim();
    }

    // --- ถ้าไม่มี key ให้ตอบ mock เลย ---
    if (!hasKey) {
      return res
        .status(200)
        .json(buildMockResponse({ query: req.query, note: 'missing api key -> mock' }));
    }

    // --- เรียก Agoda API ---
    const endpoint = 'http://affiliateapi7643.agoda.com/affiliateservice/lt_v1';

    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Accept-Encoding': 'gzip,deflate',
        'Authorization': `${CID}:${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ criteria })
    });

    if (!apiRes.ok) {
      // Agoda ตอบ 4xx/5xx -> fallback
      const txt = await safeText(apiRes);
      return res
        .status(200)
        .json(buildMockResponse({
          query: req.query,
          note: `agoda api http ${apiRes.status}`,
          raw: txt
        }));
    }

    const data = await apiRes.json().catch(() => ({}));

    // --- แปลงผลลัพธ์ให้ UI ใช้ได้ ---
    const itemsRaw =
      data?.results ||
      data?.data ||
      data?.items ||
      data?.hotels ||
      [];

    const items = itemsRaw.map((h) => mapHotel(h, currency));

    const payload = {
      ok: true,
      source: 'agoda',
      query: {
        q, checkin: criteria.checkInDate, checkout: criteria.checkOutDate,
        rooms: String(rooms), adults: String(adults), children: String(children),
        lang: criteria.additional.language, currency: criteria.additional.currency
      },
      total: items.length,
      items
    };

    if (debug === '1') payload._raw = data;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('search api error:', err);
    return res
      .status(200)
      .json(buildMockResponse({ query: req.query, note: 'exception -> mock' }));
  }
}

/* ---------------------------
   Helpers
----------------------------*/
function toInt(v, def = 0) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : def;
}

function normalizeDate(v) {
  // รับได้ทั้ง YYYY-MM-DD หรืออย่างอื่น -> แปลงเป็น YYYY-MM-DD
  if (!v) {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

function mapHotel(h, currencyFallback) {
  // พยายามรองรับ field ได้หลายแบบ
  const id = h.hotelId || h.propertyId || h.id || '';
  const name = h.hotelName || h.name || '';
  const city = h.cityName || h.city || '';
  const starRating = toNumber(h.starRating || h.star || 0);
  const reviewScore = toNumber(h.reviewScore || h.rating || h.review || 0);
  const reviewCount = toNumber(h.reviewCount || h.reviews || 0);

  const imageUrl =
    h.imageURL ||
    h.imageUrl ||
    h.photoUrl ||
    h.thumbnailUrl ||
    '';

  const priceFrom =
    toNumber(h.lowRate || h.price || h.priceFrom || 0);

  const currency = (h.currency || currencyFallback || 'THB').toUpperCase();

  const freeCancellation =
    boolish(h.freeCancellation ?? h.free_cancellation ?? false);

  const breakfastIncluded =
    boolish(h.breakfastIncluded ?? h.breakfast_included ?? false);

  const mealPlan = breakfastIncluded ? 'Breakfast included' : (h.mealPlan || '');

  const deeplink =
    h.landingURL || h.landingUrl || h.deeplink || h.url || '';

  return {
    id: String(id),
    name: String(name),
    city: String(city),
    starRating,
    reviewScore,
    reviewCount,
    imageUrl: String(imageUrl),
    priceFrom,
    currency,
    freeCancellation,
    mealPlan,
    deeplink
  };
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function boolish(v) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1' || v === 1) return true;
  return false;
}

async function safeText(r) {
  try { return await r.text(); } catch { return ''; }
}

/* ---------------------------
   Mock Fallback
----------------------------*/
function buildMockResponse({ query = {}, note = '', raw = null } = {}) {
  const today = new Date();
  const tmr = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const q = {
    q: query.q || 'Bangkok',
    checkin: query.checkin || today.toISOString().slice(0, 10),
    checkout: query.checkout || tmr.toISOString().slice(0, 10),
    rooms: String(query.rooms || '1'),
    adults: String(query.adults || '2'),
    children: String(query.children || '0'),
    lang: String(query.lang || 'en-us'),
    currency: String(query.currency || 'THB')
  };

  const items = [
    {
      id: '52120188',
      name: 'Bangkok Riverside Hotel',
      city: 'Bangkok',
      starRating: 4,
      reviewScore: 8.7,
      reviewCount: 214,
      imageUrl:
        'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 1290,
      currency: q.currency,
      freeCancellation: true,
      mealPlan: 'Breakfast included',
      deeplink:
        `https://www.agoda.com/partners/partnersearch.aspx?cid=${process.env.AGODA_CID || 'XXXX'}&city=${encodeURIComponent(q.q)}&checkIn=${q.checkin}&checkOut=${q.checkout}`
    },
    {
      id: '52120199',
      name: 'Bangkok Central Hotel',
      city: 'Bangkok',
      starRating: 3,
      reviewScore: 8.0,
      reviewCount: 120,
      imageUrl:
        'https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 990,
      currency: q.currency,
      freeCancellation: false,
      mealPlan: '',
      deeplink:
        `https://www.agoda.com/partners/partnersearch.aspx?cid=${process.env.AGODA_CID || 'XXXX'}&city=${encodeURIComponent(q.q)}&checkIn=${q.checkin}&checkOut=${q.checkout}`
    },
    {
      id: '52120222',
      name: 'Old Town Boutique',
      city: 'Bangkok',
      starRating: 5,
      reviewScore: 9.1,
      reviewCount: 84,
      imageUrl:
        'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 2890,
      currency: q.currency,
      freeCancellation: true,
      mealPlan: 'Breakfast included',
      deeplink:
        `https://www.agoda.com/partners/partnersearch.aspx?cid=${process.env.AGODA_CID || 'XXXX'}&city=${encodeURIComponent(q.q)}&checkIn=${q.checkin}&checkOut=${q.checkout}`
    }
  ];

  const resp = {
    ok: true,
    source: 'mock',
    note,
    query: q,
    total: items.length,
    items
  };
  if (raw) resp._raw = raw;
  return resp;
}
