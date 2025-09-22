// /api/search.js
export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const {
      cityid = '9395',
      checkin,
      checkout,
      adults = '2',
      children = '0',
      currency = 'USD',
      lang = 'en-us',
      max = '10',
      sort = 'PriceAsc',
      debug = '0',
    } = req.query;

    // --- Load ENV ---
    const BASE_URL = process.env.AGODA_BASE_URL;
    const SITE_ID  = process.env.AGODA_SITE_ID;
    const API_KEY  = process.env.AGODA_API_KEY;

    if (!BASE_URL || !SITE_ID || !API_KEY) {
      return res.status(500).json({ ok: false, error: "Missing Agoda credentials in ENV" });
    }

    // --- Build Payload ---
    const today = new Date();
    const defaultCheckIn = today.toISOString().slice(0,10);
    const defaultCheckOut = new Date(today.getTime() + 86400000).toISOString().slice(0,10);

    const payload = {
      criteria: {
        additional: {
          currency,
          dailyRate: { minimum: 1, maximum: 10000 },
          discountOnly: false,
          language: lang,
          maxResult: parseInt(max, 10),
          minimumReviewScore: 0,
          minimumStarRating: 0,
          occupancy: {
            numberOfAdult: parseInt(adults, 10),
            numberOfChildren: parseInt(children, 10)
          },
          sortBy: sort
        },
        checkInDate: checkin || defaultCheckIn,
        checkOutDate: checkout || defaultCheckOut,
        cityId: parseInt(cityid, 10)
      }
    };

    // --- Call Agoda API ---
    let agodaRaw = '';
    let agodaOk = false;
    let agodaJson = null;

    try {
      const resp = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Accept-Encoding': 'gzip,deflate',
          'Content-Type': 'application/json',
          'Authorization': `${SITE_ID}:${API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      agodaRaw = await resp.text();
      if (resp.ok) {
        agodaOk = true;
        agodaJson = JSON.parse(agodaRaw);
      }
    } catch (e) {
      agodaRaw = String(e.message || e);
    }

    const took = Date.now() - t0;
    return res.status(200).json({
      ok: true,
      source: agodaOk ? 'agoda' : 'mock',
      query: payload.criteria,
      result: agodaJson,
      tookMs: took,
      ...(debug === '1' ? { _raw: agodaRaw } : {})
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

