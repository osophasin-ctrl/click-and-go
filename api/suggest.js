// /api/suggest.js
// อ่านไฟล์ JSON หนึ่งครั้งแล้วแคชไว้ในหน่วยความจำของฟังก์ชัน (serverless)

import fs from 'fs';
import path from 'path';

let CACHE = null;

function loadData() {
  if (CACHE) return CACHE;
  const base = process.cwd();
  const citiesPath = path.join(base, 'data', 'cities_min.json');
  const hotelsPath = path.join(base, 'data', 'hotels_min.json');

  const cities = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));
  let hotels = [];
  try {
    hotels = JSON.parse(fs.readFileSync(hotelsPath, 'utf8'));
  } catch (e) {
    hotels = [];
  }

  // สร้าง index เบื้องต้น (ตัวพิมพ์เล็ก)
  const norm = s => (s || '').toString().toLowerCase();

  const cityIdx = cities.map(c => ({
    id: c.id,
    th: c.th,
    en: c.en || c.th,
    countryId: c.countryId,
    th_lc: norm(c.th),
    en_lc: norm(c.en || c.th),
  }));

  const hotelIdx = hotels.map(h => ({
    id: h.id,
    th: h.th,
    en: h.en || h.th,
    cityId: h.cityId,
    cityName: h.cityName,
    countryId: h.countryId,
    th_lc: norm(h.th),
    en_lc: norm(h.en || h.th),
  }));

  CACHE = { cityIdx, hotelIdx };
  return CACHE;
}

export default function handler(req, res) {
  try {
    const { cityIdx, hotelIdx } = loadData();

    const q = String(req.query.q || '').trim();
    if (!q) return res.status(200).json({ ok: true, items: [] });

    const lang = String(req.query.lang || 'th-th').toLowerCase();
    const isTH = lang.startsWith('th');

    const qlc = q.toLowerCase();

    // หาเมืองก่อน (ขึ้นก่อน)
    let cities = cityIdx.filter(c =>
      c.th_lc.includes(qlc) || c.en_lc.includes(qlc)
    ).slice(0, 10);

    // หาโรงแรม (จำกัดให้เบาหน่อย)
    let hotels = hotelIdx.filter(h =>
      h.th_lc.includes(qlc) || h.en_lc.includes(qlc)
    ).slice(0, 10);

    // map ให้อยู่รูปเดียวกับกล่อง suggest ฝั่งหน้า deals
    const cityItems = cities.map(c => ({
      type: 'city',
      id: String(c.id),
      label: isTH ? c.th : (c.en || c.th),
      subtitle: isTH ? 'เมือง' : 'City',
      city: isTH ? c.th : (c.en || c.th),
      country: '',   // ถ้ามี mapping ประเทศค่อยเติม
    }));

    const hotelItems = hotels.map(h => ({
      type: 'hotel',
      id: String(h.id),
      label: isTH ? h.th : (h.en || h.th),
      subtitle: isTH ? (h.cityName || 'โรงแรม') : (h.cityName || 'Hotel'),
      cityId: h.cityId ? String(h.cityId) : undefined,
      city: h.cityName || '',
    }));

    // เมืองอยู่บน โรงแรมตามหลัง
    const items = [...cityItems, ...hotelItems].slice(0, 10);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
