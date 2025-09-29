// /api/city-suggest.js
// Next.js (Pages API / Vercel Serverless)
// อ่านรายชื่อเมืองจาก data/cities_slim.json แล้วทำ suggest ตาม q (ไทย/อังกฤษ)
// รองรับ limit และค้นหาแบบ partial (ไม่จำเป็นต้องขึ้นต้น)

import fs from 'fs';
import path from 'path';

const MAX_LIMIT = 30;

// ล้างวรรณยุกต์/สระประกอบทั้ง Latin และ Thai + จัดรูปให้ค้นหาได้
function normalize(str) {
  if (str == null) return '';
  let s = String(str).toLowerCase().trim();

  // แยกตัวประกอบ (สำหรับภาษา latin) แล้วตัดเครื่องหมายกำกับ
  try {
    s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch (_) {
    // บาง runtime อาจไม่รองรับ normalize – ข้ามไป
  }

  // ตัดเครื่องหมายกำกับของอักษรไทย (สระ/วรรณยุกต์/การันต์ ฯลฯ)
  // U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E
  s = s.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '');

  // ตัดช่องว่างซ้ำให้เป็นช่องว่างเดียว
  s = s.replace(/\s+/g, ' ');
  return s;
}

function tokenize(s) {
  s = normalize(s);
  return s.length ? s.split(' ') : [];
}

// --- โหลดฐานข้อมูลครั้งเดียว (cache บนตัวแปร global) ---
let cityIndexPromise = null;

function loadCityIndexOnce() {
  if (!cityIndexPromise) {
    cityIndexPromise = new Promise((resolve, reject) => {
      try {
        const filePath = path.join(process.cwd(), 'data', 'cities_slim.json');
        const raw = fs.readFileSync(filePath, 'utf8');
        const list = JSON.parse(raw); // expected: [{ city_id, city_name }, ...]
        // เตรียมฟิลด์ที่ normalize ไว้ล่วงหน้า เพื่อความเร็ว
        const idx = list
          .filter(x => x && (x.city_name || x.name || x.CityName))
          .map(x => {
            const name =
              x.city_name ??
              x.name ??
              x.CityName ??
              '';
            return {
              id: x.city_id ?? x.id ?? null,
              name: String(name),
              norm: normalize(name),
            };
          });
        resolve(idx);
      } catch (err) {
        reject(err);
      }
    });
  }
  return cityIndexPromise;
}

// ค้นหาแบบ "ทุก token ต้องพบในชื่อ" และให้คะแนนตามตำแหน่ง/ความยาว
function searchCities(index, q, limit = 10) {
  const qNorm = normalize(q);
  if (!qNorm) return [];

  const qTokens = tokenize(q);
  const results = [];

  for (const item of index) {
    if (!item.norm) continue;

    // เงื่อนไข: ทุก token ต้องอยู่ในชื่อ (แบบ contains)
    let ok = true;
    let firstPos = Infinity;
    for (const t of qTokens) {
      const p = item.norm.indexOf(t);
      if (p === -1) {
        ok = false;
        break;
      }
      if (p < firstPos) firstPos = p;
    }
    if (!ok) continue;

    // คำนวณคะแนนอย่างง่าย: ตำแหน่งเริ่มยิ่งน้อยยิ่งดี + ชื่อสั้นกว่าดีกว่า
    const score = firstPos * 10 + item.norm.length;
    results.push({ ...item, score });
  }

  results.sort((a, b) => a.score - b.score);

  return results.slice(0, Math.min(limit, MAX_LIMIT)).map(r => ({
    id: r.id,
    text: r.name,   // ชื่อที่จะแสดงใน auto-complete
    type: 'city',
  }));
}

// --- Handler ---
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const q = (req.query.q ?? '').toString().trim();
    const limit = Number.parseInt(req.query.limit ?? '10', 10);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, MAX_LIMIT)) : 10;

    // ไม่บังคับภาษา/โซนอีกต่อไป (เคยทำให้ผลลัพธ์ว่างเมื่อ lang != th)
    const index = await loadCityIndexOnce();

    const items = searchCities(index, q, safeLimit);
    return res.status(200).json({
      ok: true,
      q,
      count: items.length,
      items,
    });
  } catch (err) {
    console.error('city-suggest error', err);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
