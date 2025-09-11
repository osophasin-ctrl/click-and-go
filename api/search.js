// /api/search.js
// Agoda Affiliate Lite API v2 — using GEO criteria (lat/lng + radius) instead of area/cityId.
// If Agoda returns error, we fall back to mock data (so UI still works).

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const {
      q = 'Bangkok',
      checkin,
      checkout,
      rooms = '1',
      adults = '2',
      children = '0',
      lang = 'en-us',
      currency = 'THB',
      debug = '0',
    } = req.query;

    // --- Basic sanitize/parse ---
    const cityName = String(q || '').trim();
    const checkIn = String(checkin || '').trim();
    const checkOut = String(checkout || '').trim();
    const numRooms = Math.max(1, parseInt(String(rooms), 10) || 1);
    const numAdults = Math.max(1, parseInt(String(adults), 10) || 1);
    const numChildren = Math.max(0, parseInt(String(children), 10) || 0);
    const language = String(lang || 'en-us').toLowerCase();
    const curr = String(currency || 'THB').toUpperCase();

    // --- GEO mapping (lat/lng + radiusKm) for popular cities ---
    const GEO = {
      // Thailand
      'bangkok':        { lat: 13.7563, lng: 100.5018, radiusKm: 25 },
      'กรุงเทพ':        { lat: 13.7563, lng: 100.5018, radiusKm: 25 },
      'chiang mai':     { lat: 18.7883, lng: 98.9853,  radiusKm: 20 },
      'เชียงใหม่':       { lat: 18.7883, lng: 98.9853,  radiusKm: 20 },
      'phuket':         { lat: 7.8804,  lng: 98.3923,   radiusKm: 25 },
      'ภูเก็ต':          { lat: 7.8804,  lng: 98.3923,   radiusKm: 25 },
      'pattaya':        { lat: 12.9236, lng: 100.8825,  radiusKm: 18 },
      'พัทยา':          { lat: 12.9236, lng: 100.8825,  radiusKm: 18 },
      'krabi':          { lat: 8.0863,  lng: 98.9063,   radiusKm: 25 },
      'กระบี่':          { lat: 8.0863,  lng: 98.9063,   radiusKm: 25 },
      'hua hin':        { lat: 12.5684, lng: 99.9577,   radiusKm: 18 },
      'หัวหิน':          { lat: 12.5684, lng: 99.9577,   radiusKm: 18 },

      // Intl (examples)
      'tokyo':          { lat: 35.6762, lng: 139.6503, radiusKm: 25 },
      'โตเกียว':         { lat: 35.6762, lng: 139.6503, radiusKm: 25 },
      'seoul':          { lat: 37.5665, lng: 126.9780, radiusKm: 25 },
      'โซล':            { lat: 37.5665, lng: 126.9780, radiusKm: 25 },
      'singapore':      { lat: 1.3521,  lng: 103.8198, radiusKm: 20 },
      'สิงคโปร์':         { lat: 1.3521,  lng: 103.8198, radiusKm: 20 },
      'hong kong':      { lat: 22.3193, lng: 114.1694, radiusKm: 20 },
      'ฮ่องกง':          { lat: 22.3193, lng: 114.1694, radiusKm: 20 },
      'london':         { lat: 51.5074, lng: -0.1278,  radiusKm: 25 },
      'paris':          { lat: 48.8566, lng: 2.3522,   radiusKm: 25 },
    };

    // Find normalized key
    const key = cityName.toLowerCase();
    const geo = GEO[key] || GEO['bangkok']; // fallback to Bangkok
    const { lat, lng, radiusKm } = geo;

    // Build Agoda request body
    // (Structure here follows typical Affiliate Lite examples. If doc differs, adjust field names accordingly.)
    const criteria = {
      geo: {
        latitude: lat,
        longitude: lng,
        radius: { unit: 'km', value: radiusKm || 20 }
      },
      checkInDate: checkIn || new Date().toISOString().slice(0, 10),
      checkOutDate: checkOut || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      rooms: [
        {
          numberOfAdults: numAdults,
          childAges: Array.from({ length: numChildren }, () => 8) // default age if user didn't specify
        }
      ],
      resultCount: 10,
      sortOrder: 'PRICE'
    };

    // If more than 1 room, duplicate with safe occupancy
    while (criteria.rooms.length < numRooms) {
      criteria.rooms.push({ numberOfAdults: 1, childAges: [] });
    }

    const body = {
      currency: curr,
      language,
      criteria
    };

    // Read credentials from env
    const PARTNER_ID = process.env.AGODA_PARTNER_ID || '';
    const API_KEY    = process.env.AGODA_API_KEY    || '';
    const AGODA_URL  = process.env.AGODA_API_URL   || 'https://affiliate-api.agoda.com/api/v2/hotels/search';

    let agodaOk = false;
    let agodaJson = null;
    let agodaRaw = '';

    try {
      const resp = await fetch(AGODA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          'X-Agoda-APIKey':    API_KEY,
          'X-Agoda-PartnerId': PARTNER_ID
        },
        body: JSON.stringify(body)
      });

      agodaRaw = await resp.text();

      if (resp.ok) {
        agodaOk = true;
        agodaJson = JSON.parse(agodaRaw);
      } else {
        agodaOk = false;
      }
    } catch (e) {
      agodaOk = false;
      agodaRaw = String(e?.message || e);
    }

    // Map Agoda result -> simplified items
    const items = [];
    if (agodaOk && agodaJson) {
      const list = agodaJson.items || agodaJson.hotels || [];
      for (const h of list) {
        items.push({
          id: String(h.id || h.hotelId || ''),
          name: h.name || h.hotelName || '',
          city: cityName,
          starRating: h.starRating || h.star || null,
          reviewScore: h.reviewScore || h.rating || null,
          reviewCount: h.reviewCount || null,
          imageUrl: (h.imageUrl || (h.images && h.images[0])) || '',
          priceFrom: h.priceFrom || (h.price && h.price.total) || null,
          currency: curr,
          freeCancellation: h.freeCancellation || false,
          mealPlan: h.mealPlan || '',
          deeplink: h.deeplink || h.url || ''
        });
      }
    } else {
      // Fallback mock data — so UI still works while credentials/format are being finalized
      items.push(
        {
          id: '52120188',
          name: 'Bangkok Riverside Hotel',
          city: 'Bangkok',
          starRating: 4,
          reviewScore: 8.7,
          reviewCount: 214,
          imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
          priceFrom: 1290,
          currency: curr,
          freeCancellation: true,
          mealPlan: 'Breakfast included',
          deeplink: `https://www.agoda.com/partners/partnersearch.aspx?cid=1949420&city=Bangkok&checkIn=${criteria.checkInDate}&checkOut=${criteria.checkOutDate}`
        },
        {
          id: '52120199',
          name: 'Bangkok Central Hotel',
          city: 'Bangkok',
          starRating: 3,
          reviewScore: 8.0,
          reviewCount: 120,
          imageUrl: 'https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?q=80&w=1200&auto=format&fit=crop',
          priceFrom: 990,
          currency: curr,
          freeCancellation: false,
          mealPlan: '',
          deeplink: `https://www.agoda.com/partners/partnersearch.aspx?cid=1949420&city=Bangkok&checkIn=${criteria.checkInDate}&checkOut=${criteria.checkOutDate}`
        },
        {
          id: '52120222',
          name: 'Old Town Boutique',
          city: 'Bangkok',
          starRating: 5,
          reviewScore: 9.1,
          reviewCount: 84,
          imageUrl: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=1200&auto=format&fit=crop',
          priceFrom: 2890,
          currency: curr,
          freeCancellation: true,
          mealPlan: 'Breakfast included',
          deeplink: `https://www.agoda.com/partners/partnersearch.aspx?cid=1949420&city=Bangkok&checkIn=${criteria.checkInDate}&checkOut=${criteria.checkOutDate}`
        }
      );
    }

    const took = Date.now() - t0;
    const payload = {
      ok: true,
      source: agodaOk ? 'agoda' : 'mock',
      ...(agodaOk ? {} : { note: `agoda api http fallback` }),
      query: {
        cityName,
        checkIn: criteria.checkInDate,
        checkOut: criteria.checkOutDate,
        rooms: numRooms,
        adults: numAdults,
        children: numChildren,
        currency: curr,
        language,
        resultCount: criteria.resultCount,
        sortOrder: criteria.sortOrder
      },
      total: items.length,
      items,
      tookMs: took
    };

    if (debug === '1') payload._raw = agodaRaw;
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json(payload);

  } catch (e) {
    console.error(e);
    res.setHeader('Cache-Control','no-store');
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
