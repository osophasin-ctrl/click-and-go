// /api/suggest.js
// Suggestion API สำหรับ Click & Go
// รองรับค้นหาชื่อเมือง TH/EN, คืนค่า cityId, label/subtitle
// สามารถใช้เป็น backend สำหรับ autocomplete

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
  // 👇 เพิ่มเมืองอื่น ๆ ได้ตามต้องการ เช่น
  // { id: 'DMK', en: 'Don Mueang', th: 'ดอนเมือง', country: 'Thailand' },
];

export default function handler(req, res) {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const lang = String(req.query.lang || 'th-th').toLowerCase();

    // คืนค่าว่างถ้าไม่มี q
    if (!q) {
      return res.status(200).json({ ok: true, items: [] });
    }

    const matched = CITIES.filter(c => {
      const en = c.en.toLowerCase();
      const th = c.th.toLowerCase();
      return en.includes(q) || th.includes(q);
    }).slice(0, 8);

    const items = matched.map(c => {
      const label = lang.startsWith('th') ? c.th : c.en;
      return {
        id: c.id,        // cityId (สำคัญสำหรับยิง Agoda)
        label,           // ใช้โชว์ในช่องค้นหา
        subtitle: c.country,
        city: label,     // ให้ฝั่ง deals/search ใช้โชว์
        country: c.country,
        en: c.en,
        th: c.th
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error('suggest.js error', e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
