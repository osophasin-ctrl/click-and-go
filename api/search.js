// /api/search.js — Vercel Serverless (CommonJS)
// รับ query จากหน้าเว็บ → แปลงเป็น payload lt_v1 → เรียก Agoda → ส่งกลับในรูปแบบที่หน้า search.html ใช้ได้

const AGODA_URL = "http://affiliateapi7643.agoda.com/affiliateservice/lt_v1";

const SITE_ID = process.env.AGODA_SITE_ID || "1949420";
const API_KEY = process.env.AGODA_API_KEY || "b80d95c1-7e21-4935-b319-28feff6a60f1";

const SORT_MAP = { rec: "Recommended", price_asc: "PriceAsc", price_desc: "PriceDesc" };

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
    const cityId = qstr(req, "cityId", qstr(req, "cityid", ""));
    const hid = qstr(req, "hid", "");
    const checkin = qstr(req, "checkin", "");
    const checkout = qstr(req, "checkout", "");
    const adults = Math.max(1, qint(req, "adults", 2));
    const children = Math.max(0, qint(req, "children", 0));
    const currency = qstr(req, "currency", "THB");
    const lang = qstr(req, "lang", "th-th");
    const limit = Math.max(1, qint(req, "limit", 30));
    const sortBy = SORT_MAP[qstr(req, "sort", "rec")] || "Recommended";

    if (!checkin || !checkout) {
      return res.status(200).json({ ok: false, reason: "missing_dates", results: [] });
    }
    if (!cityId && !hid) {
      return res.status(200).json({ ok: false, reason: "missing_id", results: [] });
    }

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
          dailyRate: { minimum: 1, maximum: 1000000 },
          occupancy: { numberOfAdult: adults, numberOfChildren: children }
        },
        checkInDate: checkin,
        checkOutDate: checkout
      }
    };
    if (hid) payload.criteria.hotelId = parseInt(hid, 10);
    else payload.criteria.cityId = parseInt(cityId, 10);

    const resp = await fetch(AGODA_URL, {
      method: "POST",
      headers: {
        "Accept-Encoding": "gzip,deflate",
        "Content-Type": "application/json",
        "Authorization": `${SITE_ID}:${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!resp.ok) {
      return res.status(200).json({
        ok: false, reason: `agoda_http_${resp.status}`, message: text, results: [], payload
      });
    }

    // ---------- NORMALIZE: ใช้คีย์ที่เห็นจาก debug ----------
    const arr =
      (Array.isArray(data && data.results) && data.results) ||
      (Array.isArray(data && data.hotels) && data.hotels) ||
      (Array.isArray(data && data.data) && data.data) ||
      [];

    const items = arr.map((r) => {
      // จาก debug: imageURL, landingURL, dailyRate, hotelName, starRating, reviewScore, currency
      const priceFromAgoda =
        (r.dailyRate && (r.dailyRate.total || r.dailyRate.dailyTotal || r.dailyRate.minRate)) ||
        r.dailyRate || r.lowRate || r.price || null;

      const currencyFromAgoda = r.currency || currency;

      const thumb =
        r.imageURL || r.thumbnailUrl || r.imageUrl || r.photoUrl || r.thumbnail || "";

      const url =
        r.landingURL || r.deeplinkUrl || r.deeplink || r.url || r.agodaUrl || "#";

      return {
        name: r.hotelName || r.name || r.propertyName || "",
        thumbnail: thumb,
        rating: r.starRating ?? null,
        reviewScore: r.reviewScore ?? null,
        price: priceFromAgoda,
        currency: currencyFromAgoda,
        url
      };
    });

    if (qstr(req, "debug", "") === "1") {
      return res.status(200).json({ ok: true, payload, raw: data ?? text, results: items });
    }

    return res.status(200).json({ ok: true, results: items });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: "exception", message: String(err), results: [] });
  }
};
