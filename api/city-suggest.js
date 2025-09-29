// /api/city-suggest.js
// Suggest เมืองจาก data/cities_slim.json
// ส่งฟิลด์ให้ครบทั้งที่หน้าเว็บต้องการและ fallback (city_id, city_name, label, value, subtitle)

import fs from 'fs';
import path from 'path';

const MAX_LIMIT = 30;

function qstr(req, key, def = '') {
  const v = (req.query && req.query[key]) ?? def;
  return (v == null ? '' : String(v)).trim();
}
function qint(req, key, def = 10) {
  const n = parseInt(qstr(req, key, String(def)), 10);
  return Number.isFinite(n) ? n : def;
}

// ล้างวรรณยุกต์/สระประกอบทั้ง Latin และไทย
function normalize(s) {
  if (!s) return '';
  let x = String(s).toLowerCase().trim();
  try {
    x = x.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch {}
  // ตัดสระ/วรรณยุกต์ไทย
  x = x.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '');
  // ช่องว่างซ้ำ
  x = x.replace(/\s+/g, ' ');
  return x;
}
const hasThai = (s) => /[\u0E00-\u0E7F]/.test(s || '');

let CACHE = null;
function loadCities() {
  if (CACHE) return CACHE;

  const p = path.join(process.cwd(), 'data', 'cities_slim.json');
  const raw = fs.readFileSync(p, 'utf8');
  const arr = JSON.parse(raw);

  // รองรับทั้งรูป {id, th, en} หรือ {city_id, city_name, name_en}
  CACHE = arr
    .map((it) => {
      const id = it.city_id ?? it.id ?? '';
      const th = it.th ?? it.city_name ?? it.name_th ?? '';
      const en = it.en ?? it.name_en ?? '';
      const nameTH = String(th || en || '');
      const nameEN = String(en || th || '');
      return {
        id: String(id || ''),
        th: nameTH,
        en: nameEN,
        norm_th: normalize(nameTH),
        norm_en: normalize(nameEN),
      };
    })
    .filter((x) => x.id && (x.th || x.en));

  return CACHE;
}

function findCities(list, q, limit) {
  const useTH = hasThai(q);
  const nq = normalize(q);

  const starts = [];
  const contains = [];

  for (const it of list) {
    const norm = useTH ? it.norm_th : it.norm_en;
    if (!norm) continue;
    if (norm.startsWith(nq)) {
      starts.push(it);
      if (starts.length >= limit) break;
    }
  }
  if (starts.length < limit) {
    for (const it of list) {
      const norm = useTH ? it.norm_th : it.norm_en;
      if (!norm) continue;
      if (!norm.startsWith(nq) && norm.includes(nq)) {
        contains.push(it);
        if (starts.length + contains.length >= limit) break;
      }
    }
  }

  return [...starts, ...contains].slice(0, limit).map((it) => {
    const cityName = (useTH ? (it.th || it.en) : (it.en || it.th)) || it.th || it.en || '';
    return {
      type: 'City',
      city_id: it.id,
      city_name: cityName,

      // เพิ่มฟิลด์ fallback ให้หน้าเว็บที่ยังอ่าน label/value
      label: cityName,
      value: it.id,

      subtitle: 'เมือง',
    };
  });
}

export default function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    }

    const q = qstr(req, 'q');
    const limit = Math.max(1, Math.min(qint(req, 'limit', 10), MAX_LIMIT));

    if (!q) {
      res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=120');
      return res.status(200).json({ ok: true, items: [] });
    }

    const data = loadCities();
    const items = findCities(data, q, limit);

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error('city-suggest error:', err);
    return res.status(200).json({ ok: false, reason: 'internal_error' });
  }
}
