// /api/search.js  — Vercel Serverless Function (CommonJS)
// แปลงพารามิเตอร์จากหน้าเว็บ → payload Agoda lt_v1

const AGODA_URL = "http://affiliateapi7643.agoda.com/affiliateservice/lt_v1";

// แนะนำให้ตั้งใน Vercel Project Settings → Environment Variables
const SITE_ID = process.env.AGODA_SITE_ID || "1949420";
const API_KEY = process.env.AGODA_API_KEY || "b80d95c1-7e21-4935-b319-28feff6a60f1";

// แมปตัวเลือกเรียงจาก UI → Agoda
const SORT_MAP = { rec: "Recommended", price_asc: "PriceAsc", price_desc: "PriceDesc" };

// helper: อ่านค่า query ปลอดภัย
function qstr(req, key, def = "") {
  const v = (req.query && req.query[key]) || def;
  return (v == null ? "" : String(v)).trim();
}
function qint(req, key, def = 0) {
  const n = parseInt(qstr(req, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}

module.exports = async function (req, res) {
  try {
    // -------- read query --------
    const q = qstr(req, "q", "");
    const cityId = qstr(req, "cityId", qstr(req, "cityid", ""));
    const hid = qstr(req, "hid", "");

    const checkin = qstr(req, "checkin", "");
    const checkout = qstr(req, "checkout", "");

    const rooms = Math.max(1, qint(req, "rooms", 1)); // (ยังไม่ใช้กับ lt_v1)
    const adults = Math.max(1, qint(req, "adults", 2));
    const children = Math.max(0, qint(req, "children", 0));

    const currency = qstr(req, "currency", "THB");
    const lang = qstr(req, "lang", "th-th");
    const limit = Math.max(1, qint(req, "limit", 30));
    const sortBy = SORT_MAP[qstr(req, "sort", "rec")] || "Recommended";

    // validate ขั้นต้น
    if (!checkin || !checkout) {
      return res.status(200).json({ ok: false, reason: "missing_dates", results: [] });
    }
    if (!cityId && !hid) {
      return res.status(200).json({ ok: false, reason: "missing_id", results: [] });
    }

    // -------- build payload lt_v1 --------
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
          occupancy: { numberOfAdult: adults, numberOfChildren: children }
        },
        checkInDate: checkin,
        checkOutDate: checkout
      }
    };
    if (hid) payload.criteria.hotelId = parseInt(hid, 10);
    else payload.criteria.cityId = parseInt(cityId, 10);

    // -------- call Agoda --------
    const resp = await fetch(AGODA_URL, {
      method: "POST",
      headers: {
        "Accept-Encoding": "gzip,deflate",
        "Content-Type": "application/json",
        "Authorization": `${SITE_ID}:${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    let dataText = await resp.text();
    let dataJson = null;
    try { dataJson = JSON.parse(dataText); } catch (_e) {}

    if (!resp.ok) {
      return res.status(200).json({
        ok: false,
        reason: `agoda_http_${resp.status}`,
        message: dataText,
        results: [],
        payload
      });
    }

    // -------- normalize results ให้หน้าเว็บ --------
    const arr =
      (Array.isArray(dataJson && dataJson.results) && dataJson.results) ||
      (Array.isArray(dataJson && dataJson.hotels) && dataJson.hotels) ||
      (Array.isArray(dataJson && dataJson.data) && dataJson.data) ||
      [];

    const items = arr.map((r) => {
      const price =
        (r.dailyRate && (r.dailyRate.total || r.dailyRate.dailyTotal || r.dailyRate.minRate)) ||
        r.lowRate || r.price || null;
      const url = r.deeplinkUrl || r.deeplink || r.url || r.agodaUrl || "#";
      const thumb = r.thumbnailUrl || r.imageUrl || r.photoUrl || r.thumbnail || "";
      return {
        name: r.hotelName || r.name || r.propertyName || "",
        thumbnail: thumb,
        rating: r.starRating ?? null,
        reviewScore: r.reviewScore ?? null,
        price,
        currency,
        url
      };
    });

    // โหมด debug
    if (qstr(req, "debug", "") === "1") {
      return res.status(200).json({ ok: true, payload, raw: dataJson ?? dataText, results: items });
    }

    return res.status(200).json({ ok: true, results: items });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: "exception", message: String(err), results: [] });
  }
};
