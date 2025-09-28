// /api/search.js — Vercel Serverless (CommonJS)
// รับ query → แปลงเป็น payload lt_v1 → (ลองหา hid จาก /api/hotel-search ก่อน) → (fallback) /api/suggest → เรียก Agoda

const AGODA_URL = "http://affiliateapi7643.agoda.com/affiliateservice/lt_v1";

const SITE_ID = process.env.AGODA_SITE_ID || "1949420";
const API_KEY = process.env.AGODA_API_KEY || "b80d95c1-7e21-4935-b319-28feff6a60f1";

const SORT_MAP = { rec: "Recommended", price_asc: "PriceAsc", price_desc: "PriceDesc" };

// ---------- helpers ----------
function qstr(req, key, def = "") {
  const v = (req.query && req.query[key]) || def;
  return (v == null ? "" : String(v)).trim();
}
function qint(req, key, def = 0) {
  const n = parseInt(qstr(req, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}
function qnum(req, key, def = 0) {
  const n = parseFloat(qstr(req, key, String(def)));
  return Number.isFinite(n) ? n : def;
}
function qbool(req, key, def = false) {
  const v = qstr(req, key, def ? "1" : "");
  const t = v.toString().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
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

// ---------- query normalization / suggest picking ----------
function normalizeQuery(q) {
  if (!q) return q;
  return String(q).replace(/กรุงเทพฯ/g, "กรุงเทพ").trim();
}
function pickFromSuggest(items) {
  if (!Array.isArray(items) || !items.length) return { cityId: "", hid: "", label: "" };

  // เลือกโรงแรมก่อน
  for (const it of items) {
    const t = String(it.type || "").toLowerCase();
    const hotelId = it.hotel_id || it.id;
    if (t.includes("hotel") || it.hotel_id) {
      const hid = String(hotelId || "");
      if (hid) return { cityId: "", hid, label: it.label || it.hotel_name || "" };
    }
  }
  // ไม่มีก็เลือกเมือง
  for (const it of items) {
    const t = String(it.type || "").toLowerCase();
    const id = it.city_id ?? it.value ?? it.id;
    if (t.includes("city") || it.city_id || it.value) {
      const cityId = String(id || "");
      if (cityId) return { cityId, hid: "", label: it.label || it.city_name || "" };
    }
  }
  // fallback: รายการแรกเป็นเมือง
  const it = items[0];
  const cityId = String((it && (it.city_id ?? it.value ?? it.id)) || "");
  return { cityId, hid: "", label: (it && (it.label || it.city_name)) || "" };
}

// ---------- Agoda partner deeplink ----------
function buildAgodaUrl({ cityId, hid, currency, checkin, checkout, adults, children, rooms = 1 }) {
  const base = `https://www.agoda.com/partners/partnersearch.aspx?cid=${SITE_ID}`;
  const common =
    `&currency=${encodeURIComponent(currency)}`
    + `&checkin=${encodeURIComponent(checkin)}`
    + `&checkout=${encodeURIComponent(checkout)}`
    + `&NumberofAdults=${adults}`
    + `&NumberofChildren=${children}`
    + `&Rooms=${rooms}`;
  if (hid) return `${base}&hid=${encodeURIComponent(hid)}${common}`;
  if (cityId) return `${base}&city=${encodeURIComponent(cityId)}${common}`;
  return "";
}

// ---------- main ----------
module.exports = async function (req, res) {
  try {
    // -------- read query --------
    const qRaw     = qstr(req, "q", "");
    const q        = normalizeQuery(qRaw);
    let cityId     = qstr(req, "cityId", qstr(req, "cityid", ""));
    let hid        = qstr(req, "hid", "");
    const checkin  = qstr(req, "checkin", "");
    const checkout = qstr(req, "checkout", "");
    const adults   = Math.max(1, qint(req, "adults", 2));
    const children = Math.max(0, qint(req, "children", 0));
    const rooms    = Math.max(1, qint(req, "rooms", 1)); // ใช้สำหรับ deeplink เท่านั้น
    const currency = qstr(req, "currency", "THB");
    const lang     = qstr(req, "lang", "th-th");
    const limitRaw = Math.max(1, qint(req, "limit", 30));
    const limit    = Math.min(30, limitRaw); // lt_v1 รองรับสูงสุด 30
    const sortBy   = SORT_MAP[qstr(req, "sort", "rec")] || "Recommended";

    // ฟิลเตอร์
    const priceMin = Math.max(1, qint(req, "priceMin", 1));
    const priceMax = Math.max(priceMin, qint(req, "priceMax", 1000000));
    const starsMin = Math.max(0, qint(req, "starsMin", 0));
    const scoreMin = Math.max(0, Math.min(10, qnum(req, "scoreMin", 0)));
    const discountOnly = qbool(req, "discountOnly", false);

    // children ages
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

    // -------- FAST HOTEL RESOLVE: หา hid จาก index ก่อน (/api/hotel-search) --------
    if (!hid && q) {
      try {
        const base = hostOrigin(req);
        const langForIndex = (lang || "").toLowerCase().includes("th") ? "th" : "en";
        const hsUrl = `${base}/api/hotel-search?q=${encodeURIComponent(q)}&lang=${langForIndex}&limit=10`;
        const hsRes = await fetch(hsUrl, { cache: "no-store" });
        const hs = await hsRes.json().catch(() => null);
        if (hs && hs.ok && Array.isArray(hs.items) && hs.items.length) {
          const first = hs.items[0];
          if (first && first.hotel_id) {
            hid = String(first.hotel_id);
          }
        }
      } catch (_) {}
    }

    // -------- BACKEND FALLBACK: /api/suggest --------
    if (!cityId && !hid && q) {
      try {
        const base = hostOrigin(req);
        const url = `${base}/api/suggest?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&type=mixed`;
        const sRes = await fetch(url, { cache: "no-store" });
        const sJson = await sRes.json().catch(() => null);
        if (sJson && sJson.ok && Array.isArray(sJson.items) && sJson.items.length) {
          const picked = pickFromSuggest(sJson.items);
          if (picked.hid) hid = picked.hid;
          if (picked.cityId) cityId = picked.cityId;
        }
      } catch (_) {}
    }

    if (!cityId && !hid) {
      return res.status(200).json({ ok: false, reason: "missing_id", results: [] });
    }

    // -------- build payload (เริ่มด้วย hotelIds เป็น array เพื่อกัน 400) --------
    function buildPayload({ useArrayForHotelIds = true }) {
      const additional = {
        currency,
        language: lang,
        maxResult: limit,
        discountOnly,
        minimumReviewScore: scoreMin,
        minimumStarRating: starsMin,
        sortBy,
        dailyRate: { minimum: priceMin, maximum: priceMax },
        occupancy: {
          numberOfAdult: adults,
          numberOfChildren: children,
          ...(children > 0 ? { childrenAges } : {})
        }
      };
      const criteria = { additional, checkInDate: checkin, checkOutDate: checkout };

      if (hid) {
        const n = parseInt(hid, 10);
        if (useArrayForHotelIds) criteria.hotelIds = [n];   // ✅ สคีมาปัจจุบันต้องการ array
        else criteria.hotelId = n;                          // fallback ถ้าฝั่ง Agoda เปลี่ยนกลับ
      } else {
        criteria.cityId = parseInt(cityId, 10);
      }
      return { criteria };
    }

    // -------- call Agoda (พร้อม retry ถ้าเจอ 400 รูปแบบ key ไม่ตรง) --------
    let payload = buildPayload({ useArrayForHotelIds: true });
    let resp = await fetch(AGODA_URL, {
      method: "POST",
      headers: {
        "Accept-Encoding": "gzip,deflate",
        "Content-Type": "application/json",
        "Authorization": `${SITE_ID}:${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    let text = await resp.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    // ถ้า 400 และข้อความ error ชี้ว่าคีย์ไม่ตรง ให้ลองสลับรูปแบบอีกที
    if (!resp.ok && resp.status === 400 && hid) {
      const t = (text || "").toLowerCase();
      const mentionArray = t.includes("array expected") || t.includes("hotelid") || t.includes("hotelids");
      const mentionInteger = t.includes("integer expected") || t.includes("integer found");
      // ถ้าบอกให้ใช้ array → เราก็ใช้แล้ว ข้าม
      // ถ้าบอกให้ใช้ integer → ลองอีกครั้งด้วย hotelId (เดี่ยว)
      if (mentionInteger) {
        payload = buildPayload({ useArrayForHotelIds: false });
        resp = await fetch(AGODA_URL, {
          method: "POST",
          headers: {
            "Accept-Encoding": "gzip,deflate",
            "Content-Type": "application/json",
            "Authorization": `${SITE_ID}:${API_KEY}`
          },
          body: JSON.stringify(payload)
        });
        text = await resp.text();
        data = null;
        try { data = JSON.parse(text); } catch (_) {}
      }
    }

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

    // —— deeplink ปุ่ม “ค้นหาเพิ่มเติมจากพันธมิตรของเรา”
    const agodaUrl = buildAgodaUrl({
      cityId, hid, currency, checkin, checkout, adults, children, rooms
    });

    // debug (ปิดใน production)
    const isProd = process.env.NODE_ENV === "production";
    const wantDebug = qstr(req, "debug", "") === "1";
    if (wantDebug && !isProd) {
      return res.status(200).json({ ok: true, payload, raw: data ?? text, results: items, agodaUrl });
    }

    return res.status(200).json({ ok: true, results: items, agodaUrl });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: "exception", message: String(err), results: [] });
  }
};
