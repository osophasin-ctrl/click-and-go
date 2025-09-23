// /api/search.js
// Agoda Affiliate Lite v1 → map เป็น items[] ที่ UI ใช้ได้ทันที

export default async function handler(req, res) {
  const t0 = Date.now();

  // ----- อ่าน environment / ตั้งค่าต้นทาง -----
  const BASE_URL = process.env.AGODA_BASE_URL || 'http://affiliateapi7643.agoda.com/affiliateservice/lt_v1';
  const SITE_ID  = process.env.AGODA_SITE_ID  || process.env.AGODA_STTE_ID || ''; // กันพิมพ์ผิด
  const API_KEY  = process.env.AGODA_API_KEY  || '';

  if (!BASE_URL || !SITE_ID || !API_KEY) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({
      ok: false,
      error: 'Missing environment variables (AGODA_BASE_URL / AGODA_SITE_ID / AGODA_API_KEY)'
    });
  }

  // ----- อ่าน query จากหน้า UI -----
  const {
    // รองรับสองแบบ: cityid (แนะนำ) หรือ q แล้วจะพยายาม map
    cityid,
    q,

    checkin,
    checkout,
    adults    = '2',
    children  = '0',
    rooms     = '1',
    currency  = 'USD',
    lang      = 'en-us',

    // ฟีลด์ UI เผื่อไว้ (ไม่ส่งต่อ Agoda ก็มี)
    sort      = 'PRICE_ASC',     // PRICE_ASC | PRICE_DESC | RATING_DESC | STARS_DESC
    minPrice, maxPrice,
    reviewMin,
    freeCancel,

    // debug
    debug     = '0'
  } = req.query;

  // ----- แปลง/ป้องกันค่าพื้นฐาน -----
  const safeCheckIn  = (checkin  || new Date().toISOString().slice(0, 10));
  const safeCheckOut = (checkout || new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const nAdults   = Math.max(1, parseInt(String(adults), 10)   || 2);
  const nChildren = Math.max(0, parseInt(String(children), 10) || 0);
  const nRooms    = Math.max(1, parseInt(String(rooms), 10)    || 1);
  const curr      = String(currency || 'USD').toUpperCase();
  const language  = String(lang || 'en-us').toLowerCase();

  // ----- q → cityId mapper (กรณีไม่ได้ส่ง cityid มา) -----
  const CITY_MAP = {
    // Thailand
    'bangkok': 9395, 'กรุงเทพ': 9395,
    'chiang mai': 9394, 'เชียงใหม่': 9394,
    'phuket': 9398, 'ภูเก็ต': 9398,
    'pattaya': 9399, 'พัทยา': 9399,
    'krabi': 9397, 'กระบี่': 9397,
    'hua hin': 9396, 'หัวหิน': 9396,
    // Examples (ถ้ามี cityId จริงสามารถเติมเพิ่มได้)
    'tokyo':  // ใส่ตามที่คุณมีได้
      0,
    'seoul':
      0,
    'singapore':
      0,
    'hong kong':
      0,
  };

  let cityId = 0;
  if (cityid) {
    cityId = parseInt(String(cityid), 10) || 0;
  } else if (q) {
    const key = String(q).trim().toLowerCase();
    cityId = CITY_MAP[key] || 0;
  }

  // ถ้าไม่มี cityId จริงๆ ก็ยังเรียกได้ แต่ Agoda Lite v1 ต้องการ cityId
  if (!cityId) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      source: 'none',
      note: 'cityId not provided and cannot map from q',
      query: { q: q || '', cityId, checkIn: safeCheckIn, checkOut: safeCheckOut, currency: curr, language },
      total: 0,
      items: [],
      tookMs: Date.now() - t0
    });
  }

  // ----- map sort ให้เข้ากับ Lite v1 -----
  // Lite v1 ใช้ค่า: PriceAsc | PriceDesc | Recommended (เป็นค่า default) ฯลฯ
  const SORT_MAP = {
    'PRICE_ASC':  'PriceAsc',
    'PRICE_DESC': 'PriceDesc',
    'RATING_DESC': 'ReviewScoreDesc', // บาง env อาจไม่มี ถ้าไม่มีจะไม่กระทบ เราจะ fallback ด้านล่าง
    'STARS_DESC':  'StarRatingDesc'
  };
  const sortBy = SORT_MAP[String(sort).toUpperCase()] || 'PriceAsc';

  // ----- dailyRate จาก minPrice/maxPrice (ถ้ามี) -----
  const dailyRate = {};
  if (minPrice && !isNaN(minPrice)) dailyRate.minimum = Number(minPrice);
  else dailyRate.minimum = 1; // กัน Agoda ค่าต่ำสุด 1
  if (maxPrice && !isNaN(maxPrice)) dailyRate.maximum = Number(maxPrice);
  else dailyRate.maximum = 10000;

  // ----- payload ตาม Lite v1 (City Search) -----
  const payload = {
    criteria: {
      checkInDate:  safeCheckIn,
      checkOutDate: safeCheckOut,
      cityId:       cityId,
      additional: {
        currency: curr,
        dailyRate,
        discountOnly: false,
        language,
        maxResult: 10,
        minimumReviewScore: (reviewMin ? Number(reviewMin) : 0),
        minimumStarRating:  0,
        occupancy: {
          numberOfAdult:   nAdults,     // ตามสเปก Lite v1 ใช้ชื่อนี้
          numberOfChildren: nChildren
        },
        sortBy: sortBy
        // freeCancel: Lite v1 ปกติไม่มี flag ให้ filter ฝั่ง server → เรา filter ฝั่ง client/หลังแม็พแทน
      }
    }
  };

  // ถ้ามีหลายห้อง (Lite v1 ไม่มี rooms array) เราคงส่งได้แค่ 1 เซ็ต
  // แนะนำให้แตกดีลลิสต์ฝั่ง UI/ดีพ์ลิงก์เองเมื่อมีหลายห้อง

  // ----- เรียก Agoda -----
  const headers = {
    'Accept-Encoding': 'gzip,deflate',
    'Authorization':   `${SITE_ID}:${API_KEY}`,
    'Content-Type':    'application/json'
  };

  let agodaOk = false;
  let agodaJson = null;
  let agodaRaw  = '';
  try {
    const resp = await fetch(BASE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    agodaRaw = await resp.text();

    if (resp.ok) {
      agodaOk = true;
      try { agodaJson = JSON.parse(agodaRaw); }
      catch { agodaJson = null; agodaOk = false; }
    }
  } catch (e) {
    agodaOk = false;
    agodaRaw = String(e?.message || e);
  }

  // ----- map Agoda -> items[] ที่ UI ต้องการ -----
  let items = [];
  if (agodaOk && agodaJson) {
    const list = agodaJson?.result?.results || [];
    items = list.map(h => ({
      id:           String(h.hotelId ?? ''),
      name:         h.hotelName ?? '',
      city:         q ? String(q) : '',               // อ้างจากคำค้น
      starRating:   Number(h.starRating ?? 0),
      reviewScore:  Number(h.reviewScore ?? 0),
      reviewCount:  Number(h.reviewCount ?? 0),
      imageUrl:     h.imageURL ?? '',
      priceFrom:    Number(h.dailyRate ?? 0),
      currency:     h.currency ?? curr,
      freeCancellation: Boolean(h.freeWifi ?? false) && false, // Lite v1 ไม่ให้ free cancel → กำหนด false
      mealPlan:     h.includeBreakfast ? 'Breakfast included' : '',
      deeplink:     h.landingURL ?? '',
      latitude:     h.latitude ?? null,
      longitude:    h.longitude ?? null
    }));

    // กรองฝั่ง server ให้เล็กลงตาม UI ถ้าต้องการ (optional)
    if (freeCancel === '1') {
      items = items.filter(x => x.freeCancellation);
    }
    if (minPrice && !isNaN(minPrice)) {
      items = items.filter(x => (x.priceFrom ?? 0) >= Number(minPrice));
    }
    if (maxPrice && !isNaN(maxPrice)) {
      items = items.filter(x => (x.priceFrom ?? 0) <= Number(maxPrice));
    }
    if (reviewMin && !isNaN(reviewMin)) {
      items = items.filter(x => (x.reviewScore ?? 0) >= Number(reviewMin));
    }

    // fallback sort ฝั่งเรา (กรณี sortBy ของ Agoda ไม่รองรับบางค่า)
    items.sort((a,b)=>{
      switch (String(sort).toUpperCase()) {
        case 'PRICE_ASC':  return (a.priceFrom||0) - (b.priceFrom||0);
        case 'PRICE_DESC': return (b.priceFrom||0) - (a.priceFrom||0);
        case 'RATING_DESC':return (b.reviewScore||0) - (a.reviewScore||0);
        case 'STARS_DESC': return (b.starRating||0) - (a.starRating||0);
        default: return 0;
      }
    });
  }

  const took = Date.now() - t0;

  // ----- ส่งกลับรูปแบบมาตรฐานของเรา -----
  const payloadOut = {
    ok: true,
    source: agodaOk ? 'agoda' : 'mock',
    query: {
      cityId,
      q: q || '',
      checkIn: safeCheckIn,
      checkOut: safeCheckOut,
      adults: nAdults,
      children: nChildren,
      rooms: nRooms,
      currency: curr,
      language,
      sort,
      minPrice: (minPrice ?? null),
      maxPrice: (maxPrice ?? null)
    },
    total: items.length,
    items,
    tookMs: took
  };

  if (debug === '1') payloadOut._raw = agodaRaw;

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(payloadOut);
}
