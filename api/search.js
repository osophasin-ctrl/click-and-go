export default async function handler(req, res) {
  try {
    const SITE_ID = process.env.AGODA_SITE_ID;
    const API_KEY = process.env.AGODA_API_KEY;
    const BASE_URL = process.env.AGODA_BASE_URL;

    if (!SITE_ID || !API_KEY || !BASE_URL) {
      return res.status(500).json({ ok: false, error: 'Missing Agoda environment variables' });
    }

    const body = {
      criteria: {
        geo: {
          latitude: 13.7563,
          longitude: 100.5018,
          radius: { unit: 'km', value: 20 }
        },
        checkInDate: '2025-09-22',
        checkOutDate: '2025-09-23',
        rooms: [{ numberOfAdults: 2, childAges: [] }],
        resultCount: 10,
        sortOrder: 'PRICE'
      },
      currency: 'THB',
      language: 'en-us'
    };

    const resp = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'x-site-id': SITE_ID
      },
      body: JSON.stringify(body)
    });

    const raw = await resp.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}

    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: raw });
    }

    return res.status(200).json({ ok: true, source: 'agoda', raw, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

