// /api/suggest.js
// Simple city suggest (TH/EN). Later you can replace with real provider.
const CITIES = [
  { id: 'BKK',    en: 'Bangkok',         th: 'กรุงเทพ',          country: 'Thailand' },
  { id: 'CNX',    en: 'Chiang Mai',      th: 'เชียงใหม่',         country: 'Thailand' },
  { id: 'PATTAYA',en: 'Pattaya',         th: 'พัทยา',            country: 'Thailand' },
  { id: 'HKT',    en: 'Phuket',          th: 'ภูเก็ต',            country: 'Thailand' },
  { id: 'KBV',    en: 'Krabi',           th: 'กระบี่',            country: 'Thailand' },
  { id: 'HHQ',    en: 'Hua Hin',         th: 'หัวหิน',            country: 'Thailand' },
  { id: 'USM',    en: 'Koh Samui',       th: 'เกาะสมุย',          country: 'Thailand' },
  { id: 'CEI',    en: 'Chiang Rai',      th: 'เชียงราย',          country: 'Thailand' },
  { id: 'RYG',    en: 'Rayong',          th: 'ระยอง',             country: 'Thailand' },
  { id: 'TRAT',   en: 'Koh Chang (Trat)',th: 'เกาะช้าง (ตราด)',   country: 'Thailand' },
  { id: 'AYU',    en: 'Ayutthaya',       th: 'อยุธยา',            country: 'Thailand' },
  { id: 'KBI',    en: 'Kanchanaburi',    th: 'กาญจนบุรี',         country: 'Thailand' },
];

export default function handler(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const lang = String(req.query.lang || 'th-th').toLowerCase();

    const matched = CITIES.filter(c => {
      const en = c.en.toLowerCase();
      const th = c.th.toLowerCase();
      return q && (en.includes(q) || th.includes(q));
    }).slice(0, 8);

    const items = matched.map(c => {
      const label = lang.startsWith('th') ? c.th : c.en;
      return {
        id: c.id,

        // เดิม: สำหรับโค้ดที่ใช้ label/subtitle
        label,
        subtitle: c.country,

        // เพิ่ม: สำหรับโค้ดฝั่งหน้า deals ที่คาดหวัง city/country
        city: label,
        country: c.country,

        // เก็บค่า original ไว้เผื่อใช้ในอนาคต
        en: c.en,
        th: c.th
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
