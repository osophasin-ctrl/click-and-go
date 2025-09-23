// /api/search.js
// Agoda Affiliate Lite v1 (lt_v1) — ใช้รูปแบบที่ทดสอบยิงผ่านแล้ว
export default async function handler(req, res) {
  const t0 = Date.now();

  try {
    // ------ รับพารามิเตอร์จากหน้าเว็บ ------
    const {
      cityid,                          // <- ใช้ cityId ของ Agoda โดยตรง (เช่น BKK = 9395)
      checkin,
      checkout,
      adults = '2',
      children = '0',
      rooms = '1',
      currency = 'USD',
      lang = 'en-us',
      max = '10',
      sort = 'PriceAsc',               // PriceAsc | PriceDesc | Recommended ฯลฯ (ตามเอกสาร)
      debug = '0',
    } = req.query;

    // แปลงค่าให้ชัวร์
    const CITY_ID      = parseInt(String(cityid || '9395'), 10); // fallback = Bangkok
    const NUM_ADULTS   = Math.max(1, parseInt(String(adults), 10) || 2);
    const NUM_CHILDREN = Math.max(0, parseInt(String(children), 10) || 0);
    const NUM_ROOMS    = Math.max(1, parseInt(String(rooms), 10) || 1);
    const MAX_RESULT   = Math.min(30, Math.max(1, parseInt(String(max), 10) || 10));
    const CURRENCY     = String(currency || 'USD').toUpperCase();
    const LANGUAGE     = String(lang || 'en-us').toLowerCase();
    const CHECKIN      = String(checkin || new Date().toISOString().slice(0,10));
    const CHECKOUT     = String(checkout || new Date(Date.now()+86400000).toISOString().slice(0,10));
    const SORT_BY      = String(sort || 'PriceAsc');

    // ------ ENV (ตั้งแล้วใน Vercel) ------
    const BASE_URL = process.env.AGODA_BASE_URL || 'http://affiliateapi7643.agoda.com/affiliateservice/lt_v1';
    const SITE_ID  = process.env.AGODA_SITE_ID;
    const API_KEY  = process.env.AGODA_API_KEY;

    if (!BASE_URL || !SITE_ID || !API_KEY) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).json({ ok:false, error: 'Missing env: AGODA_BASE_URL / AGODA_SITE_ID / AGODA_API_KEY' });
    }

    // ------ payload ตามฟอร์แมทที่ “ยิงผ่านแล้ว” ------
    const payload = {
      criteria: {
        additional: {
          currency: CURRENCY,
          dailyRate: { minimum: 1, maximum: 10000 },
          discountOnly: false,
          language: LANGUAGE,
          maxResult: MAX_RESULT,
          minimumReviewScore: 0,
          minimumStarRating: 0,
          occupancy: { numberOfAdult: NUM_ADULTS, numberOfChildren: NUM_CHILDREN },
          sortBy: SORT_BY
        },
        checkInDate: CHECKIN,
        checkOutDate: CHECKOUT,
        cityId: CITY_ID
      }
    };

    // ------ เรียก Agoda ------
    let agodaOk = false;
    let raw = '';
    let json = null;

    try {
      const resp = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Accept-Encoding': 'gzip,deflate',
          'Content-Type': 'application/json',
          'Authorization': `${SITE_ID}:${API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      raw = await resp.text();
      if (resp.ok) {
        json = JSON.parse(raw);
        agodaOk = true;
      }
    } catch (e) {
      raw = String(e?.message || e);
      agodaOk = false;
    }

    // ------ map เป็นรูปแบบที่หน้าเว็บใช้ได้ง่าย ------
    const results = (json && (json.results || json.result || json.items || [])) || [];
    const items = results.map(h => {
      const hid = String(h.hotelId ?? h.id ?? '');
      // ลิงก์พาร์ทเนอร์ (ใช้ hid + cid และส่งพารามิเตอร์การเข้าพัก)
      const deeplink = `https://www.agoda.com/partners/partnersearch.aspx?cid=${SITE_ID}` +
        `&hid=${encodeURIComponent(hid)}&currency=${encodeURIComponent(CURRENCY)}` +
        `&checkin=${encodeURIComponent(CHECKIN)}&checkout=${encodeURIComponent(CHECKOUT)}` +
        `&NumberOfAdults=${encodeURIComponent(NUM_ADULTS)}&NumberOfChildren=${encodeURIComponent(NUM_CHILDREN)}` +
        `&Rooms=${encodeURIComponent(NUM_ROOMS)}&pcs=6`;

      return {
        id: hid,
        name: h.hotelName || h.name || '',
        starRating: h.starRating ?? h.star ?? null,
        reviewScore: h.reviewScore ?? h.rating ?? null,
        reviewCount: h.reviewCount ?? null,
        imageUrl: h.imageURL || h.imageUrl || (h.images && h.images[0]) || '',
        priceFrom: h.dailyRate ?? h.priceFrom ?? null,
        currency: CURRENCY,
        freeCancellation: !!h.freeWifi || !!h.freeCancellation, // บางฟิลด์ไม่มี ให้เดาง่ายๆ
        mealPlan: h.includeBreakfast ? 'Breakfast included' : '',
        deeplink
      };
    });

    const out = {
      ok: true,
      source: agodaOk ? 'agoda' : 'unknown',
      query: {
        cityId: CITY_ID, checkInDate: CHECKIN, checkOutDate: CHECKOUT,
        rooms: NUM_ROOMS, numberOfAdult: NUM_ADULTS, numberOfChildren: NUM_CHILDREN,
        currency: CURRENCY, language: LANGUAGE, maxResult: MAX_RESULT, sortBy: SORT_BY
      },
      total: items.length,
      items,
      tookMs: Date.now() - t0
    };
    if (debug === '1') out._raw = raw;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);

  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}
