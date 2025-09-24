// /api/search.js  — Vercel Serverless Function
// แปลงพารามิเตอร์จากหน้าเว็บ → payload Agoda lt_v1 ให้ตรงตามสเปก

const AGODA_URL = "http://affiliateapi7643.agoda.com/affiliateservice/lt_v1";

// เก็บคีย์ไว้ใน ENV จะปลอดภัยกว่า (ใส่ใน Vercel Project Settings)
// ถ้ายังไม่ได้ตั้งค่า จะใช้ค่าด้านล่างเป็นค่าเริ่มต้นชั่วคราว
const SITE_ID = process.env.AGODA_SITE_ID || "1949420";
const API_KEY = process.env.AGODA_API_KEY || "b80d95c1-7e21-4935-b319-28feff6a60f1";

// แมป sort จาก UI → Agoda
const SORT_MAP = {
  rec: "Recommended",
  price_asc: "PriceAsc",
  price_desc: "PriceDesc",
};

export default async function handler(req, res) {
  try {
    const q = (req.query.q || "").toString().trim();
    const cityId = (req.query.cityId || req.query.cityid || "").toString().trim();
    const hid = (req.query.hid || "").toString().trim();

    const checkin = (req.query.checkin || "").toString();
    const checkout = (req.query.checkout || "").toString();

    const rooms = parseInt(req.query.rooms || "1", 10) || 1; // (ยังไม่ใช้ใน lt_v1; ใช้ผู้ใหญ่/เด็กพอ)
    const adults = Math.max(1, parseInt(req.query.adults || "2", 10) || 2);
    const children = Math.max(0, parseInt(req.query.children || "0", 10) || 0);

    const currency = (req.query.currency || "THB").toString();
    const lang = (req.query.lang || "th-th").toString();
    const limit = Math.max(1, parseInt(req.query.limit || "30", 10) || 30);
    const sortBy = SORT_MAP[req.query.sort] || "Recommended";

    // ต้องมีอย่างน้อย cityId หรือ hid
    if (!cityId && !hid) {
      return res.status(200).json({ ok: false, reason: "missing_id", results: [] });
    }

    // ----- payload Agoda lt_v1 -----
    const payload = {
      criteria: {
        additional: {
          currency,
          language: lang,
          maxResult: limit,
          discountOnly: false,
          minimumReviewScore: 0,
          minimumStarRating: 0,
          sortBy,
          dailyRate: { minimum: 1, maximum: 1000000 }, // ผ่อนคลายเพื่อให้มีผลลัพธ์
          occupancy: { numberOfAdult: adults, numberOfChildren: children },
        },
        checkInDate: checkin,
        checkOutDate: checkout,
      },
    };

    if (hid) {
      payload.criteria.hotelId = parseInt(hid, 10);
    } else {
      payload.criteria.cityId = parseInt(cityId, 10);
    }

    // ----- call Agoda -----
    const resp = await fetch(AGODA_URL, {
      method: "POST",
      headers: {
        "Accept-Encoding": "gzip,deflate",
        Authorization: `${SITE_ID}:${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res
        .status(200)
        .json({ ok: false, reason: `agoda_http_${resp.status}`, message: text, results: [] });
    }

    const data = await resp.json();

    // ----- normalize ให้หน้าเว็บ -----
    // โครงของ lt_v1 อาจต่างกันเล็กน้อยตามบัญชี → รองรับหลายชื่อฟิลด์
    const arr =
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.hotels) && data.hotels) ||
      (Array.isArray(data?.data) && data.data) ||
      [];

    const items = arr.map((r) => {
      // ราคา: ลองหลายฟิลด์ที่พบได้บ่อย
      const price =
        (r.dailyRate && (r.dailyRate.total || r.dailyRate.dailyTotal || r.dailyRate.minRate)) ||
        r.lowRate ||
        r.price ||
        null;

      // ลิงก์: deeplink/URL
      const url = r.deeplinkUrl || r.deeplink || r.url || r.agodaUrl || "#";

      // รูปภาพ
      const thumb = r.thumbnailUrl || r.imageUrl || r.photoUrl || r.thumbnail || "";

      return {
        name: r.hotelName || r.name || r.propertyName || "",
        thumbnail: thumb,
        rating: r.starRating ?? null,
        reviewScore: r.reviewScore ?? null,
        price,
        currency,
        url,
      };
    });

    // debug option: /api/search?...&de
