// /api/search.js
// Agoda Affiliate Lite v1 — ใช้รูปแบบเดียวกับสคริปต์ Python ที่ทดสอบผ่านแล้ว
// อ่านค่า ENV จาก Vercel: AGODA_SITE_ID, AGODA_API_KEY, AGODA_BASE_URL
// ตัวอย่าง BASE_URL ที่ใช้ได้: http://affiliateapi7643.agoda.com/affiliateservice/lt_v1

export default async function handler(req, res) {
  const t0 = Date.now();

  // --- อ่าน query พร้อมค่า default ---
  const {
    cityid,
    checkin,
    checkout,
    adults = "2",
    children = "0",
    lang = "en-us",
    currency = "USD",
    max = "10",
    sort = "PriceAsc", // PriceAsc | PriceDesc | Recommended ฯลฯ
    debug = "0",
  } = req.query;

  // ตรวจสอบ/แปลงชนิดข้อมูล
  const cityId = parseInt(String(cityid || ""), 10);
  const numAdults = Math.max(1, parseInt(String(adults), 10) || 1);
  const numChildren = Math.max(0, parseInt(String(children), 10) || 0);
  const language = String(lang || "en-us").toLowerCase();
  const curr = String(currency || "USD").toUpperCase();
  const maxResult = Math.max(1, Math.min(50, parseInt(String(max), 10) || 10));
  const sortBy = String(sort || "PriceAsc");

  // สร้างวันที่ default กรณีไม่ส่งมา
  const today = new Date();
  const d1 = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const d2 = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
  const checkInDate = (checkin || d1.toISOString().slice(0, 10));
  const checkOutDate = (checkout || d2.toISOString().slice(0, 10));

  // --- อ่าน ENV ---
  const SITE_ID = process.env.AGODA_SITE_ID || "";
  const API_KEY = process.env.AGODA_API_KEY || "";
  const BASE_URL =
    process.env.AGODA_BASE_URL ||
    "http://affiliateapi7643.agoda.com/affiliateservice/lt_v1";

  if (!SITE_ID || !API_KEY || !BASE_URL) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({
      ok: false,
      error: "Missing environment variables (AGODA_SITE_ID / AGODA_API_KEY / AGODA_BASE_URL)",
    });
  }

  if (!cityId) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({
      ok: false,
      error: "cityid is required (e.g., ?cityid=9395)",
    });
  }

  // --- สร้าง payload ตามสเปค Lite v1 (แบบที่ทดสอบผ่านแล้ว) ---
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
        occupancy: { numberOfAdult: numAdults, numberOfChildren: numChildren },
        sortBy,
      },
      checkInDate,
      checkOutDate,
      cityId,
    },
  };

  // --- เรียก Agoda API ---
  let agodaRaw = "";
  let agodaJson = null;
  let ok = false;

  try {
    const resp = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Accept-Encoding": "gzip,deflate",
        "Content-Type": "application/json",
        // ฟอร์แมต Authorization: "{SITE_ID}:{API_KEY}" (ตามที่ทดสอบผ่านแล้ว)
        Authorization: `${SITE_ID}:${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    agodaRaw = await resp.text();

    // พยายาม parse JSON แม้สถานะไม่ใช่ 200 เพื่อดู error body
    try {
      agodaJson = JSON.parse(agodaRaw);
    } catch {
      agodaJson = null;
    }

    ok = resp.ok && !!agodaJson && !agodaJson?.error;
  } catch (e) {
    agodaRaw = String(e?.message || e);
    ok = false;
  }

  const took = Date.now() - t0;
  res.setHeader("Cache-Control", "no-store");

  // ส่งออกผลลัพธ์ (คงโครงสร้างเดิมที่คุณใช้ตรวจสอบไว้)
  if (ok) {
    return res.status(200).json({
      ok: true,
      source: "agoda",
      query: payload.criteria,
      result: agodaJson,
      ...(debug === "1" ? { _raw: agodaRaw } : {}),
      tookMs: took,
    });
  } else {
    return res.status(200).json({
      ok: true,
      source: "agoda",
      query: payload.criteria,
      result: agodaJson?.error
        ? { error: agodaJson.error }
        : { error: { message: "No search result" } },
      ...(debug === "1" ? { _raw: agodaRaw } : {}),
      tookMs: took,
    });
  }
}
