// /api/search.js
// Standardized response schema for hotel search (mock -> ready to swap to real Agoda API)
export default async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const {
      q = 'Bangkok',
      checkin = '',
      checkout = '',
      rooms = '1',
      adults = '2',
      children = '0',
      lang = 'en-us',      // for deeplink language
      currency = 'THB'     // default currency
    } = req.query || {};

    // --------- MOCK DATA (shape ล็อกแล้ว) ----------
    const MOCK = [
      {
        id: '52120188',
        name: 'Bangkok Riverside Hotel',
        city: 'Bangkok',
        starRating: 4,
        reviewScore: 8.7,
        reviewCount: 214,
        imageUrl:
          'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
        priceFrom: 1290,
        currency: 'THB',
        freeCancellation: true,
        mealPlan: 'Breakfast included'
      },
      {
        id: '1030980',
        name: 'Bangkok Central Hotel',
        city: 'Bangkok',
        starRating: 3,
        reviewScore: 8.1,
        reviewCount: 142,
        imageUrl:
          'https://images.unsplash.com/photo-1551776235-dde6d4829808?q=80&w=1200&auto=format&fit=crop',
        priceFrom: 980,
        currency: 'THB',
        freeCancellation: false,
        mealPlan: ''
      },
      {
        id: '444480',
        name: 'Bangkok Boutique Stay',
        city: 'Bangkok',
        starRating: 4,
        reviewScore: 9.0,
        reviewCount: 88,
        imageUrl:
          'https://images.unsplash.com/photo-1501117716987-c8e02e7ec3c4?q=80&w=1200&auto=format&fit=crop',
        priceFrom: 1500,
        currency: 'THB',
        freeCancellation: true,
        mealPlan: ''
      }
    ];

    // (ตัวอย่าง) แปลงค่า q เพื่อกรอง mock ให้ดูสมจริงขึ้นเล็กน้อย
    const key = String(q).toLowerCase().trim();
    const items = MOCK.filter(h =>
      [h.name, h.city].some(v => v.toLowerCase().includes(key))
    ).map(h => ({
      ...h,
      // คืน deeplink รูปแบบพาร์ตเนอร์ (ตอนต่อ API จริงค่อยแทนลิงก์นี้)
      deeplink: `https://www.agoda.com/partners/partnersearch.aspx?pcs=1&cid=1949420&hl=${encodeURIComponent(
        lang
      )}&hid=${encodeURIComponent(h.id)}&checkin=${encodeURIComponent(
        checkin
      )}&checkout=${encodeURIComponent(
        checkout
      )}&rooms=${encodeURIComponent(rooms)}&adults=${encodeURIComponent(
        adults
      )}&children=${encodeURIComponent(children)}`
    }));

    return res.status(200).json({
      ok: true,
      source: 'mock',
      query: { q, checkin, checkout, rooms, adults, children, lang, currency },
      total: items.length,
      items
    });
  } catch (e) {
    console.error('search api error', e);
    return res.status(500).json({ ok: false, error: 'internal-error' });
  }
}
