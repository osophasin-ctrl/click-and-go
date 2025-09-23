// /api/suggest.js
// Live Agoda Suggest + graceful fallback to local static list

// ---- Fallback cities (TH/EN) ใช้เมื่อ API ภายนอกมีปัญหา ----
const FALLBACK_CITIES = [
  { id: 'BKK',     en: 'Bangkok',             th: 'กรุงเทพ',              country: 'Thailand' },
  { id: 'CNX',     en: 'Chiang Mai',          th: 'เชียงใหม่',             country: 'Thailand' },
  { id: 'PATTAYA', en: 'Pattaya',             th: 'พัทยา',                country: 'Thailand' },
  { id: 'HKT',     en: 'Phuket',              th: 'ภูเก็ต',                country: 'Thailand' },
  { id: 'KBV',     en: 'Krabi',               th: 'กระบี่',                country: 'Thailand' },
  { id: 'HHQ',     en: 'Hua Hin',             th: 'หัวหิน',                country: 'Thailand' },
  { id: 'USM',     en: 'Koh Samui',           th: 'เกาะสมุย',              country: 'Thailand' },
  { id: 'CEI',     en: 'Chiang Rai',          th: 'เชียงราย',              country: 'Thailand' },
  { id: 'RYG',     en: 'Rayong',              th: 'ระยอง',                 country: 'Thailand' },
  { id: 'TRAT',    en: 'Koh Chang (Trat)',    th: 'เกาะช้าง (ตราด)',       country: 'Thailand' },
  { id: 'AYU',     en: 'Ayutthaya',           th: 'อยุธยา',                country: 'Thailand' },
  { id: 'KBI',     en: 'Kanchanaburi',        th: 'กาญจนบุรี',             country: 'Thailand' },
];

// ---- Helper: สร้างผลลัพธ์จาก fallback ----
function fallbackSuggest(q, lang = 'th-th') {
  const qq = (q || '').trim().toLowerCase();
  if (!qq) return [];
  return FALLBACK_CITIES
    .filter(c => c.en.toLowerCase().includes(qq) || c.th.toLowerCase().includes(qq))
    .slice(0, 8)
    .map(c => {
      const label = lang.startsWith('th') ? c.th : c.en;
      return {
        id: c.id,
        label,
        subtitle: c.country,
        city: label,
        country: c.country,
        en: c.en,
        th: c.th,
        _source: 'fallback'
      };
    });
}

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const q    = String(req.query.q || '').trim();
    const lang = String(req.query.lang || 'th-th').toLowerCase();
    const type = String(req.query.type || 'City'); // 'City' | 'All'

    if (!q) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, items: [], tookMs: Date.now() - t0 });
    }

    // ----- ENV & Endpoint -----
    const SITE_ID   = process.env.AGODA_SITE_ID;
    const API_KEY   = process.env.AGODA_API_KEY;
    const SUGGEST_URL =
      process.env.AGODA_SUGGEST_URL ||
      process.env.AGODA_BASE_URL || // ใช้ตัวเดียวกับ search ถ้าไม่ได้แยก
      'http://affiliateapi7643.agoda.com/affiliateservice/lt_v1';

    if (!SITE_ID || !API_KEY) {
      const items = fallbackSuggest(q, lang);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, items, source: 'fallback:no-env', tookMs: Date.now() - t0 });
    }

    // ----- เรียก Agoda Suggest -----
    let json = null, raw = '';

    try {
      const resp = await fetch(SUGGEST_URL, {
        method: 'POST',
        headers: {
          'Accept-Encoding': 'gzip,deflate',
          'Content-Type': 'application/json',
          'Authorization': `${SITE_ID}:${API_KEY}`
        },
        body: JSON.stringify({
          SearchCriteria: {
            Keyword: q,
            Culture: lang,  // 'th-th' | 'en-us'
            SearchType: type // 'City' (แนะนำ) หรือ 'All' ถ้าต้องการผลชนิดอื่นร่วมด้วย
          }
        })
      });

      raw = await resp.text();
      if (resp.ok) {
        try { json = JSON.parse(raw); } catch(_) { json = null; }
      }
    } catch (e) {
      // เงียบ ๆ แล้วไป fallback
    }

    // ----- แปลงผลลัพธ์ -----
    const results = (json && (json.Results || json.results || json.items)) || [];
    let items = Array.isArray(results) ? results.map(r => {
      // พยายามรองรับชื่อคีย์ที่ต่างกันเล็กน้อย
      const id       = String(r.ObjectId ?? r.Id ?? r.id ?? '');
      const name     = r.DisplayName ?? r.Name ?? r.label ?? '';
      const region   = r.RegionName ?? r.Region ?? '';
      const country  = r.CountryName ?? r.Country ?? '';
      const label    = String(name || '').trim();
      const subtitle = String(region || country || '').trim();

      return {
        id,
        label,
        subtitle,
        city: label,
        country: country || subtitle || '',
        _source: 'agoda'
      };
    }) : [];

    // ถ้า API ไม่ได้อะไรให้ fallback
    if (!items.length) {
      items = fallbackSuggest(q, lang);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, items, source: 'fallback:empty', tookMs: Date.now() - t0 });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      items: items.slice(0, 10), // จำกัดจำนวนให้เบา
      source: 'agoda',
      tookMs: Date.now() - t0
    });

  } catch (e) {
    // กรณี exception สุดท้ายก็ fallback
    const q = String(req.query.q || '');
    const lang = String(req.query.lang || 'th-th');
    const items = fallbackSuggest(q, lang);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items, source: 'fallback:error', error: String(e?.message || e), tookMs: Date.now() - t0 });
  }
}
