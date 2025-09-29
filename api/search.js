// /api/search.js  — unified city/hotel search with hotel-filtering
// ทำงานได้ 2 โหมด: (1) ค้นหาตามเมือง (2) เลือกโรงแรมแล้วกรองด้วย hotelId/hotelName
// ข้อมูลที่คาดหวังจากฝั่ง client:
//   - เมือง:   cityId (จำเป็น), checkIn, checkOut, rooms, adults, children
//   - โรงแรม: cityId (จำเป็น), hotelId (แนะนำ), hotelName (สำรอง), และพารามิเตอร์วันที่/ผู้เข้าพักเหมือนเมือง
//
// response shape:
//   {
//     ok: true,
//     items: [ ...hotelCards... ],
//     meta: { total, filteredByHotel: boolean },
//     fallbackExternal?: { label, url }   // ให้หน้าเว็บใช้เป็น fallback ปุ่ม “ค้นหาเพิ่มเติมจากพันธมิตรของเรา”
//   }

import { URLSearchParams } from 'url';

// ---------- utils ----------
const isNonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '';

const norm = (s = '') =>
  String(s)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

// ทำ deeplink ไว้เป็น fallback กรณีกรองแล้วไม่เจอ
function buildAgodaDeeplink({ hotelId, checkIn, checkOut, adults = 2, rooms = 1 }) {
  // Agoda deeplink พื้นฐาน (เปลี่ยนโดเมน/พารามิเตอร์ตามที่คุณใช้จริง)
  // ถ้าคุณมี template เดิมอยู่แล้ว สามารถแทนที่ฟังก์ชันนี้ได้เลย
  const params = new URLSearchParams();
  if (isNonEmpty(hotelId)) params.set('hotel_id', String(hotelId));
  if (isNonEmpty(checkIn)) params.set('checkIn', checkIn);     // YYYY-MM-DD
  if (isNonEmpty(checkOut)) params.set('checkOut', checkOut);  // YYYY-MM-DD
  if (isNonEmpty(adults)) params.set('adults', String(adults));
  if (isNonEmpty(rooms)) params.set('rooms', String(rooms));
  return `https://www.agoda.com/?${params.toString()}`;
}

// ---------- core search (ของเดิมคุณ) ----------
/**
 * เรียกค้นหาพาร์ทเนอร์ด้วย "เมือง" แล้วคืนรายการการ์ดโรงแรม
 * @param {object} args { cityId, checkIn, checkOut, rooms, adults, children, limit, lang }
 * @returns {Promise<{ items: Array, meta?: object }>}
 */
async function searchPartnersByCity(args) {
  // TODO: แทนที่บล็อคนี้ด้วย logic เดิมของโปรเจ็กต์คุณ
  // โครงสร้างนี้สมมุติว่าของเดิมคืนเป็น { items: [...], meta: {...} }
  // คุณอาจจะเรียก service ภายใน, fetch ไปภายนอก, หรือรวมหลายพาร์ทเนอร์
  // ด้านล่างนี้เป็น dummy minimal ให้ไฟล์รันได้ (ควรแทนที่ด้วยของจริง)
  return { items: [], meta: { vendor: 'REPLACE_ME', cityId: args.cityId } };
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    const {
      // เมือง
      cityId,
      // โรงแรม (จาก autocomplete แท็บ "โรงแรม")
      hotelId,
      hotelName,
      // common
      checkIn,
      checkOut,
      rooms,
      adults,
      children,
      limit = 30,
      lang = 'th',
    } = req.query;

    // ป้องกันเคสไม่มี cityId เลย (ทั้งสองโหมดต้องมี)
    if (!isNonEmpty(cityId)) {
      return res.status(400).json({
        ok: false,
        error: 'cityId is required',
      });
    }

    // เรียกค้นหาแบบ "เมือง" ด้วยของเดิม
    const baseArgs = {
      cityId,
      checkIn,
      checkOut,
      rooms: rooms ? Number(rooms) : undefined,
      adults: adults ? Number(adults) : undefined,
      children: children ? Number(children) : undefined,
      limit: Number(limit) || 30,
      lang,
    };

    const base = await searchPartnersByCity(baseArgs);
    const items = Array.isArray(base?.items) ? base.items : [];

    // ถ้าไม่ได้เลือก "โรงแรม" ก็คืนตามเดิมเลย
    const isHotelMode = isNonEmpty(hotelId) || isNonEmpty(hotelName);
    if (!isHotelMode) {
      return res.status(200).json({
        ok: true,
        items,
        meta: { ...(base?.meta || {}), total: items.length, filteredByHotel: false },
      });
    }

    // ---------- โหมด "โรงแรม": filter ----------
    const idKeyCandidates = ['id', 'hotelId', 'hotel_id', 'agodaId']; // รองรับหลายชื่อคีย์เผื่อ vendor ต่างกัน
    const nameKeyCandidates = ['name', 'hotelName', 'title'];

    // helper อ่านค่า id/name จาก item
    const getHotelId = (it) => {
      for (const k of idKeyCandidates) if (isNonEmpty(it?.[k])) return String(it[k]);
      return '';
    };
    const getHotelName = (it) => {
      for (const k of nameKeyCandidates) if (isNonEmpty(it?.[k])) return String(it[k]);
      return '';
    };

    const wantedId = isNonEmpty(hotelId) ? String(hotelId) : '';
    const wantedName = norm(hotelName || '');

    let filtered = items;

    if (wantedId) {
      filtered = filtered.filter((it) => String(getHotelId(it)) === wantedId);
    }
    if (wantedName && filtered.length !== 1) {
      // ถ้า id ไม่แม่นหรือไม่มี id ให้ลอง match ด้วยชื่อ (normalize)
      filtered = filtered.filter((it) => norm(getHotelName(it)) === wantedName);
      if (filtered.length === 0) {
        // เผื่อบาง vendor มีเครื่องหมาย/เคสสะกดต่างกัน: ใช้ contains แบบหลวม
        filtered = items.filter((it) => norm(getHotelName(it)).includes(wantedName));
      }
    }

    if (filtered.length > 0) {
      return res.status(200).json({
        ok: true,
        items: filtered.slice(0, Number(limit) || 30),
        meta: { ...(base?.meta || {}), total: filtered.length, filteredByHotel: true },
      });
    }

    // ไม่เจอเลย → ส่งผลลัพธ์ว่าง + แนบ fallbackExternal ให้ปุ่ม “ค้นหาเพิ่มเติมจากพันธมิตรของเรา”
    return res.status(200).json({
      ok: true,
      items: [],
      meta: { ...(base?.meta || {}), total: 0, filteredByHotel: true },
      fallbackExternal: {
        label: 'ดูโรงแรมนี้บน Agoda',
        url: buildAgodaDeeplink({
          hotelId: wantedId,
          checkIn,
          checkOut,
          adults,
          rooms,
        }),
      },
    });
  } catch (err) {
    console.error('search error', err);
    return res.status(500).json({ ok: false, error: 'SEARCH_FAILED' });
  }
}
