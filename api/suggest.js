// /api/suggest.js
// Autocomplete เมือง/จุดหมาย ป้อน q และ lang -> คืนรายการเมือง (TH/EN)
// อ่านข้อมูลจาก /data/cities_min.json แล้ว cache ไว้ในหน่วยความจำ

import { readFile } from "fs/promises";
import path from "path";

let CITIES_CACHE = null;

async function loadCities() {
  if (CITIES_CACHE) return CITIES_CACHE;

  // รองรับรันจาก Vercel/Node ปกติ
  const filePath = path.join(process.cwd(), "data", "cities_min.json");
  const raw = await readFile(filePath, "utf8");
  const json = JSON.parse(raw);

  // พยายาม map ฟิลด์ให้ยืดหยุ่น (ไฟล์ที่คุณสร้างอาจใช้ชื่อ field ต่างกันเล็กน้อย)
  // คาดหวังโครง: { city_id, name_th, name_en, country_th, country_en }
  CITIES_CACHE = (json || []).map((r) => ({
    id: Number(r.city_id ?? r.id ?? r.CityID ?? r.cityId ?? 0),
    th: String(
      r.name_th ?? r.city_name_th ?? r.th ?? r.CityNameTH ?? ""
    ).trim(),
    en: String(
      r.name_en ?? r.city_name_en ?? r.en ?? r.CityNameEN ?? ""
    ).trim(),
    country_th: String(
      r.country_th ?? r.CountryTH ?? r.countryNameTH ?? ""
    ).trim(),
    country_en: String(
      r.country_en ?? r.CountryEN ?? r.countryNameEN ?? ""
    ).trim(),
  })).filter(x => x.id && (x.th || x.en));

  return CITIES_CACHE;
}

function includesFold(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export default async function handler(req, res) {
  try {
    const qRaw  = (req.query.q || "").toString().trim();
    const lang  = (req.query.lang || "th-th").toString().toLowerCase();

    if (!qRaw || qRaw.length < 2) {
      return res.status(200).json({ ok: true, items: [] });
    }

    const cities = await loadCities();

    // ค้นหาจากทั้งชื่อไทย/อังกฤษ
    const matched = cities.filter(c =>
      includesFold(c.th, qRaw) || includesFold(c.en, qRaw)
    ).slice(0, 10); // จำกัด 10 รายการ

    const isTH = lang.startsWith("th");

    const items = matched.map(c => {
      const label   = isTH ? (c.th || c.en) : (c.en || c.th);
      const country = isTH ? (c.country_th || c.country_en) : (c.country_en || c.country_th);
      return {
        id: c.id,                 // สำคัญ: ใช้เป็น city_id
        label,                    // ไว้โชว์บรรทัดบน
        subtitle: country,        // ไว้โชว์บรรทัดล่าง
        city: label,              // เผื่อโค้ดฝั่งหน้า deals ใช้
        country,
        th: c.th,
        en: c.en,
      };
    });

    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error("suggest error:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
}
