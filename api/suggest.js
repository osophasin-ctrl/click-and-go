// /api/suggest.js — Vercel Serverless (CommonJS)
// รองรับทั้งไฟล์ slim (id, th, en, countryId) และไฟล์เต็ม (หลายคอลัมน์)
// ตอบกลับ: { ok:true, items:[ { label, value, type:'City', city_id, city_name, subtitle? } ] }

const fs = require("fs");
const path = require("path");

function norm(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents/diacritics
    .replace(/\s+/g, "")
    .toLowerCase();
}

function safeReadJSON(fp) {
  try {
    const txt = fs.readFileSync(fp, "utf8");
    return JSON.parse(txt);
  } catch (_) {
    return null;
  }
}

function loadCities(lang = "th") {
  const base = path.join(process.cwd(), "data");
  const slim = path.join(base, "cities_slim.json");
  const full = path.join(base, "cities_min.json");

  let raw = null;
  if (fs.existsSync(slim)) raw = safeReadJSON(slim);
  if (!raw && fs.existsSync(full)) raw = safeReadJSON(full);
  if (!raw) return [];

  // รองรับหลาย schema: array, {items:[]}, {cities:[]}
  let rows = Array.isArray(raw) ? raw : raw.items || raw.cities || [];
  if (!Array.isArray(rows)) rows = [];

  const isTh = String(lang || "th").toLowerCase().startsWith("th");

  // map เป็น schema เดียวที่เราต้องการ
  const out = [];
  const seen = new Set();

  for (const r of rows) {
    const city_id =
      r.city_id ?? r.value ?? r.id ?? r.cityId ?? r.city_code ?? r.code;

    // รองรับหลายฟิลด์ รวมถึงสคีมา slim (th/en)
    const city_name =
      r.city_name ??
      r.name_th ??
      r.city_th ??
      r.label ??
      r.name ??
      (isTh ? r.th : r.en);

    if (city_id == null || !city_name) continue;

    const idNum = Number(city_id);
    const nameStr = String(city_name).trim();
    const key = `${idNum}|${nameStr}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // subtitle: ประเทศ ถ้ามี (ลองหลายชื่อฟิลด์) — ถ้าไม่มีให้เป็น ""
    const subtitle =
      r.country_name_th ||
      r.country_th ||
      r.country_name_en ||
      r.country_en ||
      r.country_name ||
      r.country ||
      "";

    out.push({
      // สำหรับหน้า deals/suggest UI
      label: nameStr,
      value: idNum,
      type: "City",
      subtitle,

      // เผื่อฝั่งหลังบ้านใช้
      city_id: idNum,
      city_name: nameStr,

      // เตรียมฟิลด์ช่วยค้นหาไว้
      _norm: norm(nameStr),
    });
  }

  return out;
}

let CACHE = { th: null, en: null };
function getAllCities(lang = "th") {
  const key = String(lang || "th").toLowerCase().startsWith("th") ? "th" : "en";
  if (!CACHE[key]) CACHE[key] = loadCities(key);
  return CACHE[key] || [];
}

module.exports = async function (req, res) {
  try {
    const q = String((req.query && req.query.q) || "").trim();
    const lang = String((req.query && req.query.lang) || "th-th").toLowerCase();
    const limitRaw = parseInt((req.query && req.query.limit) || "30", 10);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 30));

    if (!q) return res.status(200).json({ ok: true, items: [] });

    const all = getAllCities(lang);
    const nq = norm(q);

    // ค้นหา: prefix ก่อน แล้วค่อย contains
    const starts = [];
    const contains = [];
    for (const c of all) {
      if (c._norm.startsWith(nq)) {
        starts.push(c);
        if (starts.length >= limit) break;
      }
    }
    if (starts.length < limit) {
      for (const c of all) {
        if (!c._norm.startsWith(nq) && c._norm.includes(nq)) {
          contains.push(c);
          if (starts.length + contains.length >= limit) break;
        }
      }
    }

    const sel = [...starts, ...contains].slice(0, limit);
    const items = sel.map((c) => ({
      label: c.city_name,
      value: c.city_id,
      type: "City",
      city_id: c.city_id,
      city_name: c.city_name,
      subtitle: c.subtitle || "",
    }));

    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).json({ ok: true, items });
  } catch (err) {
    res.status(200).json({ ok: false, message: String(err), items: [] });
  }
};
