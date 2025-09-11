// /api/search.js
// Call Agoda Affiliate Lite API (fallback to mock on error)

export default async function handler(req, res) {
  // ---- 1) รับพารามิเตอร์จาก query ----
  const {
    q = 'Bangkok',
    checkin,
    checkout,
    rooms = '1',
    adults = '2',
    children = '0',
    lang = 'en-us',
    currency = 'THB'
  } = req.query || {};

  // ---- 2) ดึงค่า ENV (ต้องมี) ----
  const API_KEY = process.env.AGODA_API_KEY || '';
  const CID = process.env.AGODA_CID || (API_KEY.includes(':') ? API_KEY.split(':')[0] : '');

  // sanity check
  if (!API_KEY || !CID) {
    return res.status(500).json({
      ok: false,
      error: 'Missing Agoda credentials',
      hasKey: !!API_KEY,
      hasCID: !!CID
    });
  }

  // ---- 3) เตรียมเรียก Agoda API ----
  // *หมายเหตุ: บางบัญชี/เวอร์ชัน endpoint อาจต่างกัน โปรดตรวจเอกสารที่หน้า Tools > API ของคุณ
  // ด้านล่างนี้ผมใส่ endpoint ตัวอย่าง + header มาตรฐาน หาก HTTP 200 → map ผลลัพธ์
  // หากไม่ 200 หรือ shape ไม่ตรง → fallback เป็น mock (source:"mock")
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

  // ปรับ endpoint ให้ตรงกับเอกสารของคุณ (อาจเป็น /v2, /v1)
  const ENDPOINT = 'https://affiliateapi.agoda.com/affiliatelite/v2/search'; // << ปรับตามเอกสารของคุณ

  // รวมพารามิเตอร์ขั้นต่ำที่จำเป็น (บางระบบใช้ชื่อ param แตกต่างกัน)
  const url = new URL(ENDPOINT);
  url.searchParams.set('cid', CID);
  url.searchParams.set('q', String(q));
  if (checkin) url.searchParams.set('checkin', String(checkin));
  if (checkout) url.searchParams.set('checkout', String(checkout));
  url.searchParams.set('rooms', String(rooms));
  url.searchParams.set('adults', String(adults));
  url.searchParams.set('children', String(children));
  url.searchParams.set('lang', String(lang));
  url.searchParams.set('currency', String(currency));

  // headers ที่พบบ่อยสำหรับ Affiliate Lite (ถ้าเอกสารของคุณระบุชื่อ header อื่น ให้เปลี่ยนตรงนี้)
  const headers = {
    'Content-Type': 'application/json',
    // ใส่ไว้หลายชื่อเพื่อรองรับหลายเวอร์ชันของเอกสาร
    'x-api-key': API_KEY,
    'Api-Key': API_KEY,
    'X-Agoda-ApiKey': API_KEY,
    'User-Agent': 'ClickAndGo/1.0 (+https://clickandgo.asia)'
  };

  let data;
  let source = 'agoda';

  try {
    const r = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!r.ok) {
      throw new Error(`Agoda API HTTP ${r.status}`);
    }

    const raw = await r.json();

    // ---- 4) Map รูปแบบผลลัพธ์จาก Agoda → โครงสร้างของเรา ----
    // *** NOTE: โครงสร้างจริงของ Affiliate Lite อาจใช้ชื่อคีย์ต่างไป เช่น `results`, `hotels`, `items` ฯลฯ
    // ด้านล่างนี้เป็นตัวอย่างการ map ที่ยืดหยุ่น ถ้าไม่พบ array ที่คาดไว้ จะโยน error เพื่อไป fallback mock
    const itemsRaw =
      raw?.results ||
      raw?.hotels ||
      raw?.items ||
      raw?.data ||
      [];

    if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
      throw new Error('Empty results from Agoda (shape not matched)');
    }

    // map ให้เป็น format กลาง (ระวังชื่อ field ของจริงจากเอกสาร)
    const items = itemsRaw.slice(0, 20).map((h) => ({
      id: String(h.id || h.hotelId || h.propertyId || ''),
      name: h.name || h.title || 'Hotel',
      city: h.city || h.location?.city || q,
      starRating: Number(h.starRating || h.stars || 0),
      reviewScore: Number(h.reviewScore || h.rating || 0),
      reviewCount: Number(h.reviewCount || h.reviews || 0),
      imageUrl: h.imageUrl || h.thumbnailUrl || '',
      priceFrom: Number(
        h.priceFrom || h.lowestPrice || h.price || h.minPrice || 0
      ),
      currency: currency,
      freeCancellation: Boolean(
        h.freeCancellation ?? h.cancellation?.free ?? false
      ),
      mealPlan: h.mealPlan || (h.breakfastIncluded ? 'Breakfast included' : ''),
      // deeplink ไปหน้าค้นหา Agoda โดยใส่ cid + q + วันที่ (ถ้า API ให้ hid ของโรงแรมมา ก็สามารถเปลี่ยนเป็นลิงก์หน้าโรงแรมได้)
      deeplink: buildAgodaSearchLink({ cid: CID, q, checkin, checkout, rooms, adults, children, lang, currency })
    }));

    data = {
      ok: true,
      source,
      query: { q, checkin, checkout, rooms, adults, children, lang, currency },
      total: items.length,
      items
    };
  } catch (e) {
    clearTimeout(timeout);
    // ---- 5) Fallback: mock data (เพื่อให้ UI ไม่ล่ม) ----
    console.error('[Agoda API] error:', e?.message);
    source = 'mock';
    data = {
      ok: true,
      source,
      query: { q, checkin, checkout, rooms, adults, children, lang, currency },
      total: MOCK_ITEMS.length,
      items: MOCK_ITEMS.map((x) => ({
        ...x,
        deeplink: buildAgodaSearchLink({ cid: CID, q, checkin, checkout, rooms, adults, children, lang, currency }),
        currency
      }))
    };
  }

  // cache สั้น ๆ กัน spam (จะปรับตามต้องการได้)
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  return res.status(200).json(data);
}

// --- helpers ---

function buildAgodaSearchLink({ cid, q, checkin, checkout, rooms, adults, children, lang, currency }) {
  const base = 'https://www.agoda.com/partners/partnersearch.aspx';
  const u = new URL(base);
  u.searchParams.set('cid', cid);
  if (q) u.searchParams.set('city', q);
  if (checkin) u.searchParams.set('checkIn', checkin);
  if (checkout) u.searchParams.set('checkOut', checkout);
  if (rooms) u.searchParams.set('rooms', rooms);
  if (adults) u.searchParams.set('adults', adults);
  if (children) u.searchParams.set('children', children);
  if (lang) u.searchParams.set('language', lang);
  if (currency) u.searchParams.set('currency', currency);
  u.searchParams.set('pcs', '1'); // keep search
  return u.toString();
}

// Mock items สำหรับ fallback
const MOCK_ITEMS = [
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
    freeCancellation: true,
    mealPlan: 'Breakfast included'
  },
  {
    id: '52120189',
    name: 'Bangkok Central Hotel',
    city: 'Bangkok',
    starRating: 3,
    reviewScore: 8.1,
    reviewCount: 98,
    imageUrl:
      'https://images.unsplash.com/photo-1559599101-f09722fb4948?q=80&w=1200&auto=format&fit=crop',
    priceFrom: 990,
    freeCancellation: false,
    mealPlan: ''
  },
  {
    id: '52120190',
    name: 'Sukhumvit Modern Hotel',
    city: 'Bangkok',
    starRating: 5,
    reviewScore: 9.1,
    reviewCount: 468,
    imageUrl:
      'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?q=80&w=1200&auto=format&fit=crop',
    priceFrom: 2190,
    freeCancellation: true,
    mealPlan: 'Breakfast included'
  }
];
