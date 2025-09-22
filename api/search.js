// /api/search.js
// ใช้ฟอร์แมท Agoda Affiliate Lite v1 แบบที่คุณยิงสำเร็จแล้ว:
//   - Endpoint: AGODA_BASE_URL = http://affiliateapiXXXX.agoda.com/affiliateservice/lt_v1
//   - Headers:  x-api-key, x-site-id
//   - Body:     { criteria:{...}, additional:{...}, maxResult, sortBy }
// รองรับพารามิเตอร์ผ่าน query และมี mock fallback เมื่อ Agoda error

export default async function handler(req, res) {
  const t0 = Date.now();
  res.setHeader('Cache-Control', 'no-store');

  try {
    // ===== 1) อ่านค่า env =====
    const BASE_URL = process.env.AGODA_BASE_URL || '';
    const SITE_ID  = process.env.AGODA_SITE_ID  || '';
    const API_KEY  = process.env.AGODA_API_KEY  || '';

    if (!BASE_URL || !SITE_ID || !API_KEY) {
      return res.status(500).json({
        ok: false,
        error: 'Missing environment variables (AGODA_BASE_URL / AGODA_SITE_ID / AGODA_API_KEY)',
      });
    }

    // ===== 2) รับ query จากฝั่งเว็บ =====
    const {
      cityid,
      q = '',
      checkin,
      checkout,
      adults = '2',
      children = '0',
      lang = 'en-us',         // หรือ 'th-th'
      currency = 'USD',       // หรือ 'THB'
      max = '10',
      sort = 'PriceAsc',      // Recommended | PriceAsc | PriceDesc
      debug = '0',
    } = req.query;

    // แปลงค่าให้แน่นอน
    const _adults   = Math.max(1, parseInt(String(adults), 10)  || 1);
    const _children = Math.max(0, parseInt(String(children), 10) || 0);
    const _max      = Math.max(1, Math.min(50, parseInt(String(max), 10) || 10));
    const _lang     = String(lang || 'en-us').toLowerCase();
    const _ccy      = String(currency || 'USD').toUpperCase();
    const _sort     = String(sort || 'PriceAsc');

    // ===== 3) แปลงชื่อเมือง -> cityId (กรณีไม่ได้ส่ง cityid มา) =====
    // ค่า cityId ที่คุณใช้จริงและทดสอบได้แล้ว: กรุงเทพ = 9395
    const CITY_MAP = {
      bangkok: 9395,
      'กรุงเทพ': 9395,
      bkk: 9395,
      // (เพิ่มเมืองอื่นได้ภายหลัง)
    };

    let resolvedCityId = 0;
    if (cityid) {
      resolvedCityId = parseInt(String(cityid), 10) || 0;
    } else if (q) {
      const key = String(q).trim().toLowerCase();
      resolvedCityId = CITY_MAP[key] || 9395; // fallback -> กรุงเทพ
    } else {
      resolvedCityId = 9395; // default -> กรุงเทพ
    }

    // วันที่ fallback (ถ้าไม่ส่งมา)
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const checkInDate  = String(checkin  || iso(today));
    const checkOutDate = String(checkout || iso(new Date(today.getTime() + 24*60*60*1000)));

    // ===== 4) สร้าง payload ตามฟอร์แมทที่เคยยิงผ่านแล้ว =====
    const payload = {
      criteria: {
        cityId: resolvedCityId,
        checkInDate,
        checkOutDate,
        occupancy: {
          numberOfAdult: _adults,
          // Agoda Lite v1 ที่คุณยิงสำเร็จเคยส่งเฉพาะผู้ใหญ่ก็พอ
          // ถ้าต้องการส่งเด็กด้วย บางเอกสารรองรับ numberOfChildren ด้วย
          ...(Number.isFinite(_children) ? { numberOfChildren: _children } : {}),
        },
      },
      additional: {
        language: _lang,       // 'en-us' | 'th-th'
        currency: _ccy,        // 'USD' | 'THB'
        // บางพารามิเตอร์เช่น dailyRate, minimumReviewScore สามารถใส่เพิ่มได้
        // dailyRate: { minimum: 1, maximum: 10000 },
      },
      maxResult: _max,
      sortBy: _sort,          // "Recommended" | "PriceAsc" | "PriceDesc"
    };

    // ===== 5) ยิง Agoda =====
    let agodaOk = false;
    let agodaRaw = '';
    let agodaJson = null;

    try {
      const resp = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'x-site-id': SITE_ID,
          // ตามที่คุณทดสอบสำเร็จ ไม่ต้องใส่ Authorization
          'Accept-Encoding': 'gzip,deflate',
          'User-Agent': 'click-and-go/1.0',
        },
        body: JSON.stringify(payload),
      });

      agodaRaw = await resp.text();
      if (resp.ok) {
        try { agodaJson = JSON.parse(agodaRaw); } catch (_) {}
        agodaOk = true;
      } else {
        agodaOk = false;
      }
    } catch (e) {
      agodaOk = false;
      agodaRaw = String(e?.message || e);
    }

    // ===== 6) แปลงผลลัพธ์เป็นรูปแบบที่หน้าเว็บใช้ง่าย =====
    const items = [];
    if (agodaOk && agodaJson && Array.isArray(agodaJson.results)) {
      for (const h of agodaJson.results) {
        items.push({
          id: String(h.hotelId ?? ''),
          name: h.hotelName ?? '',
          starRating: h.starRating ?? null,
          reviewScore: h.reviewScore ?? null,
          reviewCount: h.reviewCount ?? null,
          currency: h.currency ?? _ccy,
          dailyRate: h.dailyRate ?? null,
          crossedOutRate: h.crossedOutRate ?? null,
          discountPercentage: h.discountPercentage ?? 0,
          imageURL: h.imageURL ?? '',
          landingURL: h.landingURL ?? '',
          includeBreakfast: Boolean(h.includeBreakfast),
          freeWifi: Boolean(h.freeWifi),
          latitude: h.latitude ?? null,
          longitude: h.longitude ?? null,
        });
      }
    } else {
      // ===== 7) mock fallback (เว็บยังดูผลลัพธ์ได้แม้ Agoda error) =====
      items.push(
        {
          id: 'mock-1',
          name: 'Bangkok Riverside Hotel',
          starRating: 4,
          reviewScore: 8.7,
          reviewCount: 214,
          currency: _ccy,
          dailyRate: 1290,
          imageURL: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
          landingURL: `https://www.agoda.com/partners/partnersearch.aspx?cid=${SITE_ID}&city=Bangkok&checkin=${checkInDate}&checkout=${checkOutDate}`,
          includeBreakfast: true,
          freeWifi: true,
        },
        {
          id: 'mock-2',
          name: 'Bangkok Central Hotel',
          starRating: 3,
          reviewScore: 8.0,
          reviewCount: 120,
          currency: _ccy,
          dailyRate: 990,
          imageURL: 'https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?q=80&w=1200&auto=format&fit=crop',
          landingURL: `https://www.agoda.com/partners/partnersearch.aspx?cid=${SITE_ID}&city=Bangkok&checkin=${checkInDate}&checkout=${checkOutDate}`,
          includeBreakfast: false,
          freeWifi: true,
        }
      );
    }

    // ===== 8) ตอบกลับ =====
    const took = Date.now() - t0;
    const out = {
      ok: true,
      source: agodaOk ? 'agoda' : 'mock',
      query: {
        cityId: resolvedCityId,
        checkInDate,
        checkOutDate,
        numberOfAdult: _adults,
        numberOfChildren: _children,
        language: _lang,
        currency: _ccy,
        maxResult: _max,
        sortBy: _sort,
      },
      total: items.length,
      items,
      tookMs: took,
    };
    if (debug === '1') out._raw = agodaRaw;

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
