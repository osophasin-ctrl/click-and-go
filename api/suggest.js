// /api/suggest.js — Vercel Serverless (CommonJS)
// รองรับทั้งไฟล์ slim (city_id, city_name) และไฟล์เต็ม (หลายคอลัมน์)
// ตอบกลับ: { ok:true, items:[ { label, value, type:'City', city_id, city_name, subtitle? } ] }

const fs = require("fs");
const path = require("path");

function norm(s) {
  return String(s || "")
    .normalize("NFKD")
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

function loadCities() {
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

  // map เป็น schema เดียวที่เราต้องการ
  const out = [];
  const seen = new Set();

  for (const r of rows) {
    const city_id =
      r.city_id ?? r.value ?? r.id ?? r.cityId ?? r.city_code ?? r.code;
    const city_name =
      r.city_name ?? r.name_th ?? r.city_th ?? r.label ?? r.name;

    if (city_id == null || !city_name) continue;

    const idNum = Number(city_id);
    const nameStr = String(city_name).trim();
    const key = `${idNum}|${nameStr}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // บางไฟล์อาจมี country_name/country_th — ถ้าไม่มีตั้งเป็น ""
    const subtitle =
      r.country_name_th ||
      r.country_name_en ||
      r.country_name ||
      r.country_th ||
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
    });
  }

  return out;
}

let CACHE = null;
function getAllCities() {
  if (!CACHE) CACHE = loadCities();
  return CACHE;
}

module.exports = async function (req, res) {
  try {
    const q = String((req.query && req.query.q) || "").trim();
    // รองรับ param เดิม ๆ (แต่ตอนนี้ไม่ได้ใช้จริง)
    // const lang = String((req.query && req.query.lang) || "th-th").toLowerCase();
    // const type = String((req.query && req.query.type) || "mixed").toLowerCase();

    if (!q) return res.status(200).json({ ok: true, items: [] });

    const all = getAllCities();
    const nq = norm(q);

    // ค้นหา: ขึ้นต้นก่อน แล้วค่อย contains
    const starts = [];
    const contains = [];
    for (const c of all) {
      const n = norm(c.city_name);
      if (n.startsWith(nq)) starts.push(c);
      else if (n.includes(nq)) contains.push(c);
      if (starts.length >= 30) break; // จำกัดผลลัพธ์
    }
    const items = starts.concat(contains).slice(0, 30);

    res.status(200).json({ ok: true, items });
  } catch (err) {
    res.status(200).json({ ok: false, message: String(err), items: [] });
  }
};
