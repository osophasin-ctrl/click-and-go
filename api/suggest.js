// /api/suggest.js
// City autocomplete จากไฟล์ JSON ที่เตรียมไว้ล่วงหน้า (data/cities.min.json)
// รองรับ TH/EN, เร็ว, ไม่ง้อ API ภายนอก

import fs from 'fs';
import path from 'path';

// ---- เตรียมแคชในหน่วยความจำ (โหลดครั้งเดียว) ----
let CITY_DATA = null;

function normalize(s = '') {
  // แปลงเป็นตัวพิมพ์เล็ก + ตัดวรรณยุกต์/สัญลักษณ์พื้นฐาน
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // diacritics
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .trim();
}

function loadCities() {
  if (CITY_DATA) return CITY_DATA;
  const file = path.join(process.cwd(), 'data', 'cities.min.json');
  const raw = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(raw);

  // เตรียมฟิลด์ช่วยค้นหา (ทำครั้งเดียว)
  json.forEach((c) => {
    c._key_th = normalize(c.name_th + ' ' + c.country_th);
    c._key_en = normalize(c.name_en + ' ' + c.country_en);
  });
  CITY_DATA = json;
  return CITY_DATA;
}

export default function handler(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    const lang = String(req.query.lang || 'th-th').toLowerCase();
    const limit = Math.min(15, Math.max(5, parseInt(String(req.query.limit || '8'), 10)));

    if (!q) {
      return res.status(200).json({ ok: true, items: [] });
    }

    const cities = loadCities();
    const keyq = normalize(q);

    // ค้นหา: ให้ TH/EN ติดอันดับก่อนตามภาษาที่ขอมา แต่ก็เปิดให้ match ทั้งคู่
    let matched = [];
    for (const c of cities) {
      const hitTH = c._key_th.includes(keyq);
      const hitEN = c._key_en.includes(keyq);
      if (hitTH || hitEN) {
        // ให้คะแนนเล็กน้อยเพื่อเรียงผลลัพธ์สวยขึ้น
        let score = 0;
        if (lang.startsWith('th')) {
          if (hitTH) score += 2;
          if (hitEN) score += 1;
        } else {
          if (hitEN) score += 2;
          if (hitTH) score += 1;
        }
        // ตรงต้นคำ bonus
        if (c._key_th.startsWith(keyq) || c._key_en.startsWith(keyq)) score += 1;
        matched.push({ c, score });
      }
      if (matched.length > 200) break; // กัน search ยาวเกินไป
    }

    matched.sort((a, b) => b.score - a.score);
    const out = matched.slice(0, limit).map(({ c }) => {
      const label = lang.startsWith('th') ? `${c.name_th}` : `${c.name_en}`;
      const subtitle = lang.startsWith('th') ? c.country_th : c.country_en;
      return {
        id: String(c.city_id),           // <-- สำคัญ: cityid ของ Agoda
        label,                           // ข้อความหลักที่แสดง (ตามภาษา)
        subtitle,                        // ประเทศ (ตามภาษา)
        city: label,
        country: subtitle,
        // เผื่อใช้
        name_th: c.name_th,
        name_en: c.name_en,
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items: out });
  } catch (e) {
    console.error(e);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
