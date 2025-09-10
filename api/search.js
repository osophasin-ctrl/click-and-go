// /api/search.js
// ค้นหาโรงแรม (เรียก Agoda แบบ remote ได้ หรือ fallback เป็น mock)
// อ่านคีย์จาก ENV: AGODA_API_KEY, AGODA_CID
// เปิด remote จริงด้วย ENV: AGODA_REMOTE=1 และตั้ง AGODA_API_BASE ตามเอกสาร Agoda

export default async function handler(req, res) {
  // ป้องกัน cache
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const {
      q = '',
      checkin = '',
      checkout = '',
      adults = '2',
      rooms = '1',
      lang = 'th-th',
      currency = 'THB',
      page = '1',
      size = '10'
    } = req.query || {};

    const AGODA_API_KEY = process.env.AGODA_API_KEY || '';
    const AGODA_CID = process.env.AGODA_CID || '';
    const AGODA_API_BASE = process.env.AGODA_API_BASE || ''; // ใส่จากเอกสาร (ถ้าใช้ remote)
    const AGODA_REMOTE = process.env.AGODA_REMOTE === '1'; // เปิด remote จริง

    // ฟอร์แมต output มาตรฐาน
    const normalize = (items = []) => {
      return items.map((it) => {
        const id = it.id || it.hid || it.hotelId || null;
        const name = it.name || it.hotelName || 'Hotel';
        const city = it.city || it.cityName || '';
        const img =
          it.imageUrl ||
          it.thumbnail ||
          it.img ||
          'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop';

        const price = it.price || it.priceFrom || null;
        const curr = it.currency || currency || 'THB';

        // สร้าง deeplink (ถ้ามี hid ใช้ hid, ถ้าไม่มีก็ลิงก์ไปหน้าค้นหา Agoda)
        let deeplink = `https://www.agoda.com/partners/partnersearch.aspx?pcs=1&cid=${encodeURIComponent(
          AGODA_CID
        )}&hl=${encodeURIComponent(lang)}`;

        if (id) {
          deeplink += `&hid=${encodeURIComponent(id)}`;
        } else if (q) {
          // หากไม่มี HID ใช้ข้อความค้นหาเป็น fallback
          deeplink += `&search=${encodeURIComponent(q)}`;
        }

        return {
          id,
          name,
          city,
          imageUrl: img,
          priceFrom: price,
          currency: curr,
          deeplink
        };
      });
    };

    // ถ้าเปิดโหมดเรียก Agoda จริง (ต้องตั้งค่า endpoint/header ตาม PDF)
    if (AGODA_REMOTE && AGODA_API_BASE && AGODA_API_KEY) {
      try {
        // *********************
        // REMOTE CALL (แก้ตาม PDF)
        // *********************

        // ตัวอย่าง path สมมุติ (โปรดอัปเดตให้ตรงสเปกจริงจากเอกสารของ Agoda)
        const endpoint = `${AGODA_API_BASE}/hotel/search`;

        // ตัวอย่าง payload/params สมมุติ (โปรดอัปเดต)
        const payload = {
          query: q,
          checkIn: checkin || null,
          checkOut: checkout || null,
          adults: Number(adults) || 2,
          rooms: Number(rooms) || 1,
          language: lang,
          currency,
          pageNumber: Number(page) || 1,
          pageSize: Number(size) || 10
        };

        // ตัวอย่าง header (โปรดอัปเดตชื่อ header ให้ตรงสเปก เช่น X-AGODA-API-KEY, X-AGODA-CID ฯลฯ)
        const headers = {
          'Content-Type': 'application/json',
          'X-AGODA-API-KEY': AGODA_API_KEY,
          'X-AGODA-CID': AGODA_CID
        };

        const resp = await fetch(endpoint, {
          method: 'POST', // หรือ GET ตามสเปก
          headers,
          body: JSON.stringify(payload)
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Agoda API response ${resp.status}: ${text}`);
        }

        const data = await resp.json();

        // โครงสร้างผลลัพธ์ของ Agoda อาจเป็น { hotels: [...] } หรืออื่น ๆ
        // ปรับ mapping ให้เข้ากับสเปกจริงของคุณ
        const hotels = Array.isArray(data?.hotels)
          ? data.hotels
          : Array.isArray(data?.results)
          ? data.results
          : [];

        return res.status(200).json({
          ok: true,
          source: 'agoda-remote',
          total: hotels.length || 0,
          items: normalize(hotels)
        });
      } catch (e) {
        // ถ้าเรียก Agoda ไม่สำเร็จ ให้ fallback เป็น mock
        console.warn('Agoda remote error:', e.message);
      }
    }

    // MOCK DATA (ใช้เมื่อยังไม่ได้เปิด remote หรือ remote ล้มเหลว)
    const mock = [
      {
        id: '52120188',
        name: q ? `${q} Riverside Hotel` : 'Riverside Bangkok Hotel',
        city: 'Bangkok',
        imageUrl:
          'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
        price: 1290,
        currency: currency || 'THB'
      },
      {
        id: '1030980',
        name: q ? `${q} Central Hotel` : 'Livotel Hotel Kaset Nawamin',
        city: 'Bangkok',
        imageUrl:
          'https://images.unsplash.com/photo-1551776235-dde6d4829808?q=80&w=1200&auto=format&fit=crop',
        price: 980,
        currency: currency || 'THB'
      },
      {
        id: '444480',
        name: q ? `${q} Boutique Stay` : 'Sky Dome Resotel',
        city: 'Bangkok',
        imageUrl:
          'https://images.unsplash.com/photo-1501117716987-c8e02e7ec3c4?q=80&w=1200&auto=format&fit=crop',
        price: 1500,
        currency: currency || 'THB'
      }
    ];

    return res.status(200).json({
      ok: true,
      source: 'mock',
      total: mock.length,
      items: normalize(mock)
    });
  } catch (err) {
    console.error('API /search error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
