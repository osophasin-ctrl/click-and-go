// /api/search.js
// Agoda Affiliate Lite v1 — format matched to the working Python script.
//
// ENV required on Vercel:
//   AGODA_BASE_URL = http://affiliateapi7643.agoda.com/affiliateservice/lt_v1
//   AGODA_SITE_ID  = 1949420
//   AGODA_API_KEY  = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

export default async function handler(req, res) {
  const t0 = Date.now();

  // --- read env ---
  const BASE_URL = process.env.AGODA_BASE_URL || '';
  const SITE_ID  = process.env.AGODA_SITE_ID  || '';
  const API_KEY  = process.env.AGODA_API_KEY  || '';

  if (!BASE_URL || !SITE_ID || !API_KEY) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({
      ok: false,
      error: 'Missing environment variables (AGODA_BASE_URL / AGODA_SITE_ID / AGODA_API_KEY)',
    });
  }

  try {
    // --- read & sanitize query ---
    const {
      cityid,
      checkin,
      checkout,
      adults = '2',
      children = '0',
      currency = 'USD',
      lang = 'en-us',
      max = '10',
      sort = 'PriceAsc', // PriceAsc | PriceDesc | Recommended
      debug = '0',
    } = req.query;

    const todayISO = new Date().toISOString().slice(0, 10);
    const tomorrowISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const cityId = parseInt(String(cityid || '9395'), 10) || 9395;
    const checkInDate = String(checkin || todayISO);
    const checkOutDate = String(checkout || tomorrowISO);
    const numberOfAdult = Math.max(1, parseInt(String(adults), 10) || 1);
    const numberOfChildren = Math.max(0, parseInt(String(children), 10) || 0);
    const maxResult = Math.max(1, parseInt(String(max), 10) || 10);
    const language = String(lang || 'en-us').toLowerCase();
    const curr = String(currency || 'USD').toUpperCase();
    const sortBy = String(sort || 'PriceAsc');

    // --- build payload (IDENTICAL fields as Python example) ---
    const payload = {
      criteria: {
        additional: {
          currency: curr,
          dailyRate: { minimum: 1, maximum: 10000 },
          discountOnly: false,
          language,
          maxResult,
          minimumReviewScore: 0,
          minimumStarRating: 0,
          occupancy: {
            numberOfAdult,
            numberOfChildren,
          },
          sortBy,
        },
        checkInDate,
        checkOutDate,
        cityId,
      },
    };

    // --- call Agoda Lite v1 (NO /search suffix) ---
    let agodaRaw = '';
    let agodaJson = null;

    const resp = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Accept-Encoding': 'gzip,deflate',
        'Authorization': `${SITE_ID}:${API_KEY}`, // <- critical format
        'Content-Type': 'application/json',
        'User-Agent': 'click-and-go/1.0',
      },
      body: JSON.stringify(payload),
    });

    agodaRaw = await resp.text();
    try { agodaJson = agodaRaw ? JSON.parse(agodaRaw) : null; } catch (_) {}

    const took = Date.now() - t0;
    res.setHeader('Cache-Control', 'no-store');

    // ส่งรูปแบบผลลัพธ์ที่ปลอดภัย: echo response กลับให้ตรวจสอบได้
    return res.status(200).json({
      ok: true,
      source: 'agoda',
      query: {
        additional: payload.criteria.additional,
        checkInDate,
        checkOutDate,
        cityId,
      },
      result: agodaJson ?? null,
      tookMs: took,
      ...(debug === '1' ? { _raw: agodaRaw } : {}),
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
}

