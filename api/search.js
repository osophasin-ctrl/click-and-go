// /api/search.js
// Agoda Affiliate Lite - search proxy + graceful fallback (mock)

const API_URL = 'https://affiliateapi7643.agoda.com/affiliateservice/lt_v1';

// ---------- helpers ----------
function num(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function parseInputParams(req) {
  const q         = String(req.query.q || req.query.city || 'Bangkok');
  const checkin   = String(req.query.checkin  || req.query.checkIn  || '');
  const checkout  = String(req.query.checkout || req.query.checkOut || '');
  const rooms     = num(req.query.rooms,    1);
  const adults    = num(req.query.adults,   2);
  const children  = num(req.query.children, 0);
  const currency  = String(req.query.currency || 'THB').toUpperCase();
  const lang      = String(req.query.lang || req.query.language || 'en-us').toLowerCase();
  const resultCnt = num(req.query.resultCount, 10);
  const sortOrder = String(req.query.sortOrder || 'PRICE').toUpperCase();

  return {
    cityName : q,
    checkIn  : checkin,
    checkOut : checkout,
    rooms,
    adults,
    children,
    currency,
    language : lang,
    resultCount : resultCnt,
    sortOrder
  };
}

function mockItems(criteria, cid) {
  const city = criteria.cityName || 'Bangkok';
  const ci = criteria.checkIn || '2025-09-24';
  const co = criteria.checkOut || '2025-09-25';
  const dl = (name) =>
    `https://www.agoda.com/partners/partnersearch.aspx?cid=${cid}&city=${encodeURIComponent(city)}&checkIn=${ci}&checkOut=${co}`;

  return [
    {
      id: '52120188',
      name: `${city} Riverside Hotel`,
      city,
      starRating: 4,
      reviewScore: 8.7,
      reviewCount: 214,
      imageUrl:
        'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 1290,
      currency: criteria.currency || 'THB',
      freeCancellation: true,
      mealPlan: 'Breakfast included',
      deeplink: dl('riverside'),
    },
    {
      id: '52120199',
      name: `${city} Central Hotel`,
      city,
      starRating: 3,
      reviewScore: 8.0,
      reviewCount: 120,
      imageUrl:
        'https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 990,
      currency: criteria.currency || 'THB',
      freeCancellation: false,
      mealPlan: '',
      deeplink: dl('central'),
    },
    {
      id: '52120222',
      name: 'Old Town Boutique',
      city,
      starRating: 5,
      reviewScore: 9.1,
      reviewCount: 84,
      imageUrl:
        'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 2890,
      currency: criteria.currency || 'THB',
      freeCancellation: true,
      mealPlan: 'Breakfast included',
      deeplink: dl('oldtown'),
    },
  ];
}

// ---------- normalizer (สำหรับกรณีต่อ API จริงสำเร็จ) ----------
function normalizeAgodaResponse(raw, criteria, cid) {
  // *** ตัวอย่างการ map รูปแบบข้อมูล (ปรับตามสคีมา API จริงได้ในอนาคต)
  // ให้เราสร้าง deeplink กลับไป Agoda พร้อม cid, checkin, checkout, city
  const ci = criteria.checkIn || '';
  const co = criteria.checkOut || '';
  const city = criteria.cityName || '';

  const items = (raw?.items || []).map((h) => ({
    id: String(h.id || h.hotelId || ''),
    name: h.name || h.hotelName || '',
    city: h.city || city,
    starRating: Number(h.starRating || h.star || 0),
    reviewScore: Number(h.reviewScore || h.rating || 0),
    reviewCount: Number(h.reviewCount || h.reviewCount || 0),
    imageUrl: h.imageUrl || h.image || '',
    priceFrom: Number(h.priceFrom || h.minRate || 0),
    currency: h.currency || criteria.currency || 'THB',
    freeCancellation: Boolean(h.freeCancellation),
    mealPlan: h.mealPlan || '',
    deeplink:
      `https://www.agoda.com/partners/partnersearch.aspx?cid=${cid}` +
      `&city=${encodeURIComponent(city)}` +
      (ci ? `&checkIn=${ci}` : '') +
      (co ? `&checkOut=${co}` : ''),
  }));

  return {
    ok: true,
    source: 'agoda',
    query: criteria,
    total: Number(raw.total || items.length),
    items,
  };
}

// ---------- handler ----------
export default async function handler(req, res) {
  const started = Date.now();
  const key = process.env.AGODA_API_KEY || '';
  if (!key) {
    // ไม่มี KEY -> mock
    const criteria = parseInputParams(req);
    const cid = '1949420';
    return res.status(200).json({
      ok: true,
      source: 'mock',
      note: 'Missing AGODA_API_KEY -> use mock',
      query: criteria,
      total: 3,
      items: mockItems(criteria, cid),
      tookMs: Date.now() - started,
    });
  }

  // แยก CID ออกมาจาก "CID:APIKEY"
  const [cidFromKey] = key.split(':');
  const CID = process.env.AGODA_CID || cidFromKey || '1949420';

  const criteria = parseInputParams(req);
  const debug = String(req.query.debug || '').toLowerCase() === '1';

  // สร้าง payload ตาม spec ของ Agoda Lite API
  const payload = { criteria };

  let apiStatus = 0;
  let rawText = '';
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        // ตาม spec Agoda Affiliate Lite:
        // Authorization = "CID:APIKEY" (ตรง ๆ ไม่ใช่ Bearer)
        Authorization: key,
        cid: CID,                          // เพิ่ม cid แยกอีกหัว
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    apiStatus = resp.status;
    rawText = await resp.text();

    // 2xx => พยายาม parse
    if (resp.ok) {
      let json;
      try { json = JSON.parse(rawText); } catch (e) { json = null; }

      if (json && !json.error) {
        const normalized = normalizeAgodaResponse(json, criteria, CID);
        if (debug) normalized._raw = rawText;
        normalized.tookMs = Date.now() - started;
        return res.status(200).json(normalized);
      }
    }

    // ถ้า Agoda ส่ง error (เช่น 401 / id 108)
    // => fallback mock พร้อมแนบ _raw ให้ debug
    const out = {
      ok: true,
      source: 'mock',
      note: `agoda api http ${apiStatus}`,
      query: criteria,
      total: 3,
      items: mockItems(criteria, CID),
    };
    if (debug) out._raw = rawText;
    out.tookMs = Date.now() - started;
    return res.status(200).json(out);
  } catch (err) {
    // network หรือ parsing error -> mock
    const out = {
      ok: true,
      source: 'mock',
      note: `agoda api fetch error: ${String(err?.message || err)}`,
      query: criteria,
      total: 3,
      items: mockItems(criteria, CID),
    };
    if (debug) out._raw = rawText;
    out.tookMs = Date.now() - started;
    return res.status(200).json(out);
  }
}
