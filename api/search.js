// /api/search.js
// Click & Go — Agoda Affiliate Lite v1 (the one we already proved works)
// Env required on Vercel: AGODA_BASE_URL, AGODA_SITE_ID, AGODA_API_KEY

export default async function handler(req, res) {
  const t0 = Date.now();

  try {
    const {
      // q รองรับชื่อเมือง แต่สำหรับ Lite v1 ต้องใช้ cityId ตัวเลข
      // เลยเปิดให้รับ cityId=... ผ่าน query โดยตรงด้วย
      q = 'Bangkok',
      cityId: cityIdParam,
      checkin,
      checkout,
      adults = '2',
      children = '0',
      rooms = '1',
      lang = 'en-us',
      currency = 'THB',
      max = '10',
      sort = 'PriceAsc',           // ตามเอกสาร Lite v1: Recommended | PriceAsc | PriceDesc ...
      debug = '0',
    } = req.query;

    // --- resolve cityId ---
    // ถ้าผู้ใช้ส่ง cityId มา ก็ใช้ตามนั้น; ไม่งั้น fallback -> Bangkok (9395)
    const CITY_FALLBACK = 9395; // Bangkok (ยืนยันจากการทดสอบของเรา)
    const cityId =
      Number.isFinite(Number(cityIdParam)) && Number(cityIdParam) > 0
        ? Number(cityIdParam)
        : CITY_FALLBACK;

    // --- sanitize basic fields ---
    const checkInDate =
      (checkin && String(checkin).slice(0, 10)) ||
      new Date().toISOString().slice(0, 10);
    const checkOutDate =
      (checkout && String(checkout).slice(0, 10)) ||
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const numberOfAdult = Math.max(1, parseInt(String(adults), 10) || 1);
    const numberOfChildren = Math.max(0, parseInt(String(children), 10) || 0);
    const numRooms = Math.max(1, parseInt(String(rooms), 10) || 1);
    const resultLimit = Math.min(50, Math.max(1, parseInt(String(max), 10) || 10));
    const language = String(lang || 'en-us').toLowerCase();
    const curr = String(currency || 'THB').toUpperCase();
    const sortBy = String(sort || 'PriceAsc');

    // --- build request body for Lite v1 ---
    const payload = {
      criteria: {
        cityId,
        checkInDate,
        checkOutDate,
        occupancy: {
          // Lite v1 รองรับผู้ใหญ่เป็นหลัก; เด็ก/ห้องเพิ่มจริง ๆ มีฟิลด์ย่อยอีก
          // เบื้องต้นให้จำนวนผู้ใหญ่เป็นตัวกำหนดหลัก (ใช้งานจริงค่อยขยายต่อ)
          numberOfAdult,
        },
      },
      additional: {
        language,
        currency: curr,
      },
      maxResult: resultLimit,
      sortBy, // e.g. Recommended | PriceAsc | PriceDesc
    };

    // --- env & endpoint ---
    const BASE_URL = process.env.AGODA_BASE_URL;   // เช่น http://affiliateapi7643.agoda.com/affiliateservice/lt_v1
    const SITE_ID  = process.env.AGODA_SITE_ID;
    const API_KEY  = process.env.AGODA_API_KEY;

    if (!BASE_URL || !SITE_ID || !API_KEY) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).json({
        ok: false,
        error: 'Missing environment variables (AGODA_BASE_URL / AGODA_SITE_ID / AGODA_API_KEY)',
      });
    }

    // Lite v1 ของเราที่ทดสอบสำเร็จ: POST ไปที่ BASE_URL ตรง ๆ (ไม่ต้อง /search)
    const url = BASE_URL;

    // --- call Agoda Lite v1 ---
    let agodaOk = false;
    let agodaRaw = '';
    let agodaJson = null;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY,
          'x-site-id': SITE_ID,
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'User-Agent': 'click-and-go/1.0',
        },
        body: JSON.stringify(payload),
      });

      agodaRaw = await resp.text();

      if (resp.ok) {
        agodaOk = true;
        agodaJson = JSON.parse(agodaRaw);
      } else {
        agodaOk = false;
      }
    } catch (err) {
      agodaOk = false;
      agodaRaw = String(err?.message || err);
    }

    // --- map result => items (ปรับตามรูปแบบที่เราเห็นจาก Lite v1)
    const items = [];
    if (agodaOk && agodaJson && Array.isArray(agodaJson.results)) {
      for (const h of agodaJson.results) {
        items.push({
          id: String(h.hotelId ?? ''),
          name: h.hotelName ?? '',
          city: q || 'Bangkok',
          starRating: h.starRating ?? null,
          reviewScore: h.reviewScore ?? null,
          reviewCount: h.reviewCount ?? null,
          dailyRate: h.dailyRate ?? null,
          currency: h.currency ?? curr,
          imageUrl: h.imageURL ?? '',
          includeBreakfast: Boolean(h.includeBreakfast),
          freeWifi: Boolean(h.freeWifi),
          latitude: h.latitude ?? null,
          longitude: h.longitude ?? null,
          // Agoda ให้ลิงก์ดีพ์ลิงก์พร้อมพารามิเตอร์ครบอยู่แล้ว
          deeplink: h.landingURL ?? '',
        });
      }
    }

    // --- fallback mock (ถ้า API ยังไม่พร้อม) ---
    if (!agodaOk) {
      items.push(
        {
          id: 'mock-1',
          name: 'Bangkok Riverside Hotel',
          city: 'Bangkok',
          starRating: 4,
          reviewScore: 8.7,
          reviewCount: 214,
          dailyRate: 1290,
          currency: curr,
          imageUrl:
            'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
          includeBreakfast: true,
          freeWifi: true,
          deeplink: `https://www.agoda.com/partners/partnersearch.aspx?cid=${SITE_ID}&city=Bangkok&checkin=${checkInDate}&checkout=${checkOutDate}`,
        },
        {
          id: 'mock-2',
          name: 'Bangkok Central Hotel',
          city: 'Bangkok',
          starRating: 3,
          reviewScore: 8.0,
          reviewCount: 120,
          dailyRate: 990,
          currency: curr,
          imageUrl:
            'https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?q=80&w=1200&auto=format&fit=crop',
          includeBreakfast: false,
          freeWifi: false,
          deeplink: `https://www.agoda.com/partners/partnersearch.aspx?cid=${SITE_ID}&city=Bangkok&checkin=${checkInDate}&checkout=${checkOutDate}`,
        }
      );
    }

    const tookMs = Date.now() - t0;
    const respPayload = {
      ok: true,
      source: agodaOk ? 'agoda' : 'mock',
      query: {
        cityId,
        checkInDate,
        checkOutDate,
        numberOfAdult,
        numberOfChildren,
        rooms: numRooms,
        currency: curr,
        language,
        maxResult: resultLimit,
        sortBy,
      },
      total: items.length,
      items,
      tookMs,
      ...(debug === '1' ? { _raw: agodaRaw } : {}),
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(respPayload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
