// /api/search.js
// Agoda Affiliate Lite - search proxy + graceful fallback (mock)

const API_URL = 'https://affiliateapi7643.agoda.com/affiliateservice/lt_v1';

// ---------- helpers ----------
function num(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function parseQuery(req) {
  const q         = String(req.query.q || req.query.city || 'Bangkok').trim();
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
    cityName : q,          // เราจะ map -> area
    checkIn  : checkin,    // เราจะ map -> checkInDate
    checkOut : checkout,   // เราจะ map -> checkOutDate
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
  const dl = () =>
    `https://www.agoda.com/partners/partnersearch.aspx?cid=${cid}` +
    `&city=${encodeURIComponent(city)}&checkIn=${ci}&checkOut=${co}`;

  return [
    {
      id: '52120188',
      name: `${city} Riverside Hotel`,
      city,
      starRating: 4,
      reviewScore: 8.7,
      reviewCount: 214,
      imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 1290,
      currency: criteria.currency || 'THB',
      freeCancellation: true,
      mealPlan: 'Breakfast included',
      deeplink: dl(),
    },
    {
      id: '52120199',
      name: `${city} Central Hotel`,
      city,
      starRating: 3,
      reviewScore: 8.0,
      reviewCount: 120,
      imageUrl: 'https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 990,
      currency: criteria.currency || 'THB',
      freeCancellation: false,
      mealPlan: '',
      deeplink: dl(),
    },
    {
      id: '52120222',
      name: 'Old Town Boutique',
      city,
      starRating: 5,
      reviewScore: 9.1,
      reviewCount: 84,
      imageUrl: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=1200&auto=format&fit=crop',
      priceFrom: 2890,
      currency: criteria.currency || 'THB',
      freeCancellation: true,
      mealPlan: 'Breakfast included',
      deeplink: dl(),
    },
  ];
}

function normalizeAgodaResponse(raw, criteria, cid) {
  const city = criteria.cityName || '';
  const ci = criteria.checkIn || '';
  const co = criteria.checkOut || '';

  const items = (raw?.items || []).map(h => ({
    id: String(h.id || h.hotelId || ''),
    name: h.name || h.hotelName || '',
    city: h.city || city,
    starRating: Number(h.starRating || h.star || 0),
    reviewScore: Number(h.reviewScore || h.rating || 0),
    reviewCount: Number(h.reviewCount || h.reviews || 0),
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
    items
  };
}

export default async function handler(req, res) {
  const started = Date.now();
  const key = process.env.AGODA_API_KEY || '';
  const [cidFromKey] = key.split(':');
  const CID = process.env.AGODA_CID || cidFromKey || '1949420';

  const input = parseQuery(req);
  const debug = String(req.query.debug || '') === '1';

  // ถ้าไม่มี key -> mock
  if (!key) {
    return res.status(200).json({
      ok: true,
      source: 'mock',
      note: 'Missing AGODA_API_KEY -> use mock',
      query: input,
      total: 3,
      items: mockItems(input, CID),
      tookMs: Date.now() - started
    });
  }

  // ---- payload ตามสเปค Agoda Lite ----
  // ใช้ `area` จากชื่อเมือง, วันที่เป็น `checkInDate` / `checkOutDate`
  // rooms -> array (จำนวนเท่ากับ rooms) แต่ถ้าทุกห้องจำนวนผู้เข้าพักเท่ากัน จะใช้แบบนี้ได้เลย
  const roomsArray = Array.from({ length: Math.max(1, input.rooms) }).map(() => ({
    adults: input.adults,
    children: input.children,
    childAges: []     // ถ้ามีเด็กและต้องระบุอายุ ให้เติมอายุเป็นตัวเลขลงไป
  }));

  const payload = {
    criteria: {
      area: input.cityName,               // ถ้ามี cityId ในอนาคตเปลี่ยนเป็น cityId แทน
      checkInDate:  input.checkIn,
      checkOutDate: input.checkOut,
      rooms: roomsArray,
      currency: input.currency,
      language: input.language,
      sortOrder: input.sortOrder,
      resultCount: input.resultCount
    }
  };

  let apiStatus = 0, rawText = '';
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: key,   // "CID:APIKEY"
        cid: CID,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    apiStatus = resp.status;
    rawText = await resp.text();

    if (resp.ok) {
      let json; try { json = JSON.parse(rawText); } catch (e) { json = null; }
      if (json && !json.error) {
        const out = normalizeAgodaResponse(json, input, CID);
        if (debug) out._raw = rawText;
        out.tookMs = Date.now() - started;
        return res.status(200).json(out);
      }
    }

    // Agoda ยัง error -> mock พร้อมแนบข้อความดิบ
    const out = {
      ok: true,
      source: 'mock',
      note: `agoda api http ${apiStatus}`,
      query: input,
      total: 3,
      items: mockItems(input, CID)
    };
    if (debug) out._raw = rawText;
    out.tookMs = Date.now() - started;
    return res.status(200).json(out);

  } catch (err) {
    const out = {
      ok: true,
      source: 'mock',
      note: `agoda api fetch error: ${String(err?.message || err)}`,
      query: input,
      total: 3,
      items: mockItems(input, CID)
    };
    if (debug) out._raw = rawText;
    out.tookMs = Date.now() - started;
    return res.status(200).json(out);
  }
}
