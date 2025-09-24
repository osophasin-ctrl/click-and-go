// /api/search.js — Vercel Serverless (CommonJS)
// รับ query จากหน้าเว็บ → แปลงเป็น payload lt_v1 → (fallback) resolve q → เรียก Agoda → ส่งกลับผลลัพธ์

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
function toAges(str) {
  return String(str || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 17);
}
function withUtm(url) {
  if (!url) return "#";
  const hasQ = url.includes("?");
  const sep = hasQ ? "&" : "?";
  return `${url}${sep}utm_source=clickandgo&utm_medium=affiliate`;
}
function guessProto(req) {
  return (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
}
function hostOrigin(req) {
  const proto = guessProto(req);
  const host = req.headers.host;
  return `${proto}://${host}`;
}

module.exports = async function (req, res) {
  try {
    // -------- read query --------
    const q        = qstr(req, "q", "");
    let cityId     = qstr(req, "cityId", qstr(req, "cityid", ""));
    let hid        = qstr(req, "hid", "");
    const checkin  = qstr(req, "checkin", "");
    const checkout = qstr(req, "checkout", "");
    const adults   = Math.max(1, qint(req, "adults", 2));
    const children = Math.max(0, qint(req, "children", 0));
    const currency = qstr(req, "currency", "THB");
    const lang     = qstr(req, "lang", "th-th");
    const limit    = Math.max(1, qint(req, "limit", 30));
    const sortBy   = SORT_MAP[qstr(req, "sort", "rec")] || "Recommended";

    // optional children ages
    let childrenAges = toAges(qstr(req, "childrenAges", ""));
    if (children > 0) {
      while (childrenAges.length < children) childrenAges.push(7);
      if (childrenAges.length > children) childrenAges = childrenAges.slice(0, children);
    } else {
      childrenAges = [];
    }

    if (!checkin || !checkout) {
      return res.status(200).json({ ok: false, reason: "missing_dates", results: [] });
    }

    // -------- BACKEND FALLBACK: resolve q -> cityId/hid --------
    if (!cityId && !hid && q) {
      try {
        const base = hostOrigin(req);
        const url = `${base}/api/suggest?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&type=mixed`;
        const sRes = await fetch(url, { cache: "no-store" });
        const sJson = await sRes.json().catch(() => null);
        if (sJson && sJson.ok && Array.isArray(sJson.items) && sJson.items.length) {
          // ให้ความสำคัญกับ Hotel ก่อน ถ้าไม่มีค่อย City / อื่น ๆ
          const toType = (t) => String(t || "").toLowerCase();
          const hotel  = sJson.items.find((it) => toType(it.type).includes("hotel"));
          const city   = sJson.items.find((it) => toType(it.type).includes("city"));
          const pick   = hotel || city || sJson.items[0];
          const t = toType(pick.type);
          if (t.includes("hotel")) hid = String(pick.id || "");
          else cityId = String(pick.id || "");
        }
      } catch (_e) {
        // เงียบ ๆ ไว้ ถ้า resolve ไม่สำเร็จ ค่อยให้ error ด้านล่างจัดการ
      }
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
          dailyRate: { minimum: 1, maximum: 1000000 },
          occupancy: {
            numberOfAdult: adults,
            numberOfChildren: children,
            ...(children > 0 ? { childrenAges } : {})
          }
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

    const text = await resp.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!resp.ok) {
      return res.status(200).json({
        ok: false, reason: `agoda_http_${resp.status}`, message: text, results: [], payload
      });
    }

    // ---------- normalize ----------
    const arr =
      (Array.isArray(data && data.results) && data.results) ||
      (Array.isArray(data && data.hotels) && data.hotels) ||
      (Array.isArray(data && data.data) && data.data) ||
      [];

    const items = arr.map((r) => {
      const price =
        (r.dailyRate && (r.dailyRate.total || r.dailyRate.dailyTotal || r.dailyRate.minRate)) ||
        r.dailyRate || r.lowRate || r.price || null;

      const thumb =
        r.imageURL || r.thumbnailUrl || r.imageUrl || r.photoUrl || r.thumbnail || "";

      const url =
        withUtm(r.landingURL || r.deeplinkUrl || r.deeplink || r.url || r.agodaUrl || "#");

      return {
        name: r.hotelName || r.name || r.propertyName || "",
        thumbnail: thumb,
        rating: r.starRating ?? null,
        reviewScore: r.reviewScore ?? null,
        price,
        currency: r.currency || currency,
        url
      };
    });

    // debug (ปิดใน production)
    const isProd = process.env.NODE_ENV === "production";
    const wantDebug = qstr(req, "debug", "") === "1";
    if (wantDebug && !isProd) {
      return res.status(200).json({ ok: true, payload, raw: data ?? text, results: items });
    }

    return res.status(200).json({ ok: true, results: items });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: "exception", message: String(err), results: [] });
  }
};
