// /api/search.js
export default async function handler(req, res) {
  try {
    const {
      q = '',
      checkin = '',
      checkout = '',
      rooms = '1',
      adults = '2',
      children = '0',
      lang = 'th-th',
      currency = 'THB',
    } = req.query;

    // --- map ชื่อเมืองหลายภาษา -> อังกฤษ (สำหรับ mock) ---
    const aliases = {
      bangkok: ['bangkok', 'bkk', 'กรุงเทพ', 'กรุงเทพฯ'],
      'chiang mai': ['chiang mai', 'chiangmai', 'cnx', 'เชียงใหม่'],
      pattaya: ['pattaya', 'พัทยา'],
      phuket: ['phuket', 'ภูเก็ต'],
      krabi: ['krabi', 'กระบี่'],
      'hua hin': ['hua hin', 'huahin', 'หัวหิน'],
    };
    function normalizeCity(input = '') {
      const s = String(input).toLowerCase().trim();
      for (const [en, arr] of Object.entries(aliases)) {
        if (arr.some(a => s.includes(a))) return en;
      }
      return s; // ถ้าไม่รู้จัก ปล่อยตามที่ส่งมา
    }

    const normCity = normalizeCity(q);

    // --- ข้อมูลตัวอย่าง (mock) เฉพาะกรุงเทพในตอนนี้ ---
    const sampleHotels = [
      {
        id: '52120188',
        name: 'Bangkok Riverside Hotel',
        city: 'Bangkok',
        imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
        priceFrom: 1290,
        currency: 'THB',
        freeCancellation: true,
        mealPlan: 'Breakfast included',
        deeplink: 'https://www.agoda.com/partners/partnersearch.aspx?pcs=1&cid=1949420&hl=th-th&hid=52120188',
      },
      {
        id: '1030980',
        name: 'Bangkok Central Hotel',
        city: 'Bangkok',
        imageUrl: 'https://images.unsplash.com/photo-1551776235-dde6d4829808?q=80&w=1200&auto=format&fit=crop',
        priceFrom: 980,
        currency: 'THB',
        freeCancellation: false,
        mealPlan: '',
        deeplink: 'https://www.agoda.com/partners/partnersearch.aspx?pcs=1&cid=1949420&hl=th-th&hid=1030980',
      },
      {
        id: '444480',
        name: 'Bangkok Boutique Stay',
        city: 'Bangkok',
        imageUrl: 'https://images.unsplash.com/photo-1501117716987-c8e02e7ec3c4?q=80&w=1200&auto=format&fit=crop',
        priceFrom: 1500,
        currency: 'THB',
        freeCancellation: true,
        mealPlan: '',
        deeplink: 'https://www.agoda.com/partners/partnersearch.aspx?pcs=1&cid=1949420&hl=th-th&hid=444480',
      },
    ];

    // ถ้าเป็น bangkok ไม่ว่าจะ TH/EN -> คืน sample, อื่น ๆ ตอนนี้ให้ว่าง (หรือจะคืน sample เหมือนกันก็ได้)
    const isBangkok =
      normCity === 'bangkok' ||
      normCity === 'bkk' ||
      aliases.bangkok.some(a => String(q).toLowerCase().includes(a));

    const items = isBangkok ? sampleHotels : [];

    // --- response ---
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      source: 'mock',
      query: { q, checkin, checkout, rooms, adults, children, lang, currency },
      total: items.length,
      items,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: 'server error' });
  }
}
