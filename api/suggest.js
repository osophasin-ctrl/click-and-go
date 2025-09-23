// /api/suggest.js
// Autocomplete เมือง/จุดหมาย ป้อนกลับเป็นรายการที่มี cityId ชัดเจน
// ต้องมีไฟล์ข้อมูล: /data/cities_min.json (JSON array)

import fs from 'fs/promises';
import path from 'path';

let CITIES_CACHE = null;

async function loadCities() {
  if (CITIES_CACHE) return CITIES_CACHE;

  // ✅ อ่านจาก /data/cities_min.json
  const filePath = path.join(process.cwd(), 'data', 'cities_min.json');
  const buf = await fs.readFile(filePath);
  const data = JSON.parse(buf.toString());

  CITIES_CACHE = Array.isArray(data) ? data.map(r => ({
    city_id: Number(r.city_id ?? r.cityId ?? r.id ?? 0),
    city_name_en: String(r.city_name_en ?? r.en ?? r.city_en ?? '').trim(),
    city_name_th: String(r.city_name_th ?? r.th ?? r.city_th ?? '').trim(),
    country_name: String(r.country_name ?? r.country ?? '').trim(),
  })) : [];

  return CITIES_CACHE;
}

export default async function handler(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const lang = String(req.query.lang || 'th-th').toLowerCase();

    if (!q) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, items: [] });
    }

    const cities = await loadCities();

    const matched = cities.filter(c => {
      const en = (c.city_name_en || '').toLowerCase();
      const th = (c.city_name_th || '').toLowerCase();
      return en.includes(q) || th.includes(q);
    }).slice(0, 12);

    const items = matched.map(c => {
      const label = lang.startsWith('th')
        ? (c.city_name_th || c.city_name_en || '')
        : (c.city_name_en || c.city_name_th || '');

      return {
        id: String(c.city_id),
        cityId: String(c.city_id),
        label,
        subtitle: c.country_name || '',
        city: label,
        country: c.country_name || ''
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error('suggest error:', e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
