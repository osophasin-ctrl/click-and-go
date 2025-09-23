// /api/suggest.js
// Approach A: Proxy ไป Agoda Suggest API (ถ้ามี ENV) + Fallback list ในตัว
export default async function handler(req, res) {
  const q     = String(req.query.q || '').trim();
  const langQ = String(req.query.lang || 'th-th').toLowerCase();   // th-th | en-us
  const type  = String(req.query.type || 'mixed');                 // City | Hotel | mixed
  const limit = Math.min(15, Math.max(1, parseInt(String(req.query.limit || 10), 10)));

  if (!q) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items: [] });
  }

  const BASE = process.env.AGODA_SUGGEST_URL || '';   // e.g. https://affiliateapiXXXX.agoda.com/affiliateservice/suggest
  const CID  = process.env.AGODA_SITE_ID || '';
  const KEY  = process.env.AGODA_API_KEY || '';

  // ----- ถ้า ENV ครบ: ลองยิงไป Agoda -----
  if (BASE && CID && KEY) {
    try {
      // NOTE: พารามิเตอร์จริงของ Agoda Suggest อาจต่างกันเล็กน้อย ขึ้นกับเอกสารของคุณ
      // ผมทำให้ยืดหยุ่น: ส่ง q, lang, type ไป และรองรับ response shapes ทั่วไป
      const url = `${BASE}?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(langQ)}&type=${encodeURIComponent(type)}`;
      const r = await fetch(url, {
        headers: { 'Authorization': `${CID}:${KEY}`, 'Accept': 'application/json' },
        cache: 'no-store',
      });

      let items = [];
      if (r.ok) {
        const j = await r.json();

        // พยายามรองรับรูปทรงที่พบบ่อย: j.items | j.results
        const rows = (j && (j.items || j.results || [])) || [];
        items = rows.slice(0, limit).map(it => {
          // เดาชื่อฟิลด์ทั่วไป
          const id   = it.id || it.cityId || it.hotelId || it.value || '';
          const lbl  = it.label || it.name || it.displayName || '';
          const sub  = it.subtitle || it.country || it.region || '';
          const t    = (it.type || '').toString().toLowerCase();

          // map เป็น City/Hotel ถ้า endpoint ส่ง string อื่นมา
          let outType = 'City';
          if (t.includes('hotel')) outType = 'Hotel';
          else if (t.includes('city')) outType = 'City';
          else if (it.hotelId) outType = 'Hotel';

          return { id, label: lbl, subtitle: sub, type: outType };
        });
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, source: 'agoda', items });
    } catch (e) {
      // ตกไป fallback ด้านล่าง
      console.warn('Suggest proxy failed, fallback local:', e?.message || e);
    }
  }

  // ----- Fallback list (กรณีไม่มี ENV/ยิงไม่ผ่าน) -----
  const lang = langQ.startsWith('th') ? 'th' : 'en';
  const CITIES = [
    { id: '9395',  en: 'Bangkok',        th: 'กรุงเทพ',      country: 'Thailand' },
    { id: '9397',  en: 'Chiang Mai',     th: 'เชียงใหม่',     country: 'Thailand' },
    { id: '9398',  en: 'Pattaya',        th: 'พัทยา',        country: 'Thailand' },
    { id: '9396',  en: 'Phuket',         th: 'ภูเก็ต',        country: 'Thailand' },
    { id: '7023',  en: 'Krabi',          th: 'กระบี่',        country: 'Thailand' },
    { id: '11278', en: 'Hua Hin',        th: 'หัวหิน',        country: 'Thailand' },
    { id: '11419', en: 'Singapore',      th: 'สิงคโปร์',      country: 'Singapore' },
    { id: '6419',  en: 'Tokyo',          th: 'โตเกียว',       country: 'Japan' },
    { id: '14690', en: 'Seoul',          th: 'โซล',          country: 'Korea'  },
    { id: '4543',  en: 'Hong Kong',      th: 'ฮ่องกง',        country: 'Hong Kong' },
    { id: '17072', en: 'London',         th: 'ลอนดอน',       country: 'United Kingdom' },
    { id: '16808', en: 'Paris',          th: 'ปารีส',         country: 'France' },
  ];

  const needle = q.toLowerCase();
  const matched = CITIES.filter(c =>
    (c.en.toLowerCase().includes(needle) || c.th.toLowerCase().includes(needle))
  ).slice(0, limit);

  const items = matched.map(c => ({
    id: c.id,
    label: lang === 'th' ? c.th : c.en,
    subtitle: c.country,
    type: 'City',
  }));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, source: 'fallback', items });
}
