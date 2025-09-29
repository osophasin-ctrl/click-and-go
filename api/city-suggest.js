// /api/city-suggest.js
// Suggest เมืองจาก data/cities_slim.json (โครง: [{ id, th, en, countryId } ...])
// คืนสคีมาตามที่หน้าเว็บคาดหวัง: { type:'City', city_id, city_name, subtitle }

import fs from 'fs';
import path from 'path';

const MAX_LIMIT = 30;

// ล้างวรรณยุกต์/สระประกอบทั้ง Latin และ Thai
function normalize(s) {
  if (!s) return '';
  let x = String(s).toLowerCase().trim();
  try { x = x.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}
  // ตัดสระ/วรรณยุกต์ไทย
  x = x.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '');
  return x.replace(/\s+/g, ' ');
}
const hasThai = (s) => /[\u0E00-\u0E7F]/.test(s || '');

let CACHE = null;
function loadCities() {
  if (CACHE) return CACHE;
  const p = path.join(process.cwd(), 'data', 'cities_slim.json');
  const raw = fs.readFileSync(p, 'utf8');
  const arr = JSON.parse(raw);

  // รองรับทั้งฟิลด์รูปแบบ {id, th, en, countryId} และรูปแบบ {city_id, city_name}
  CACHE = arr.map((it) => {
    const id = it.city_id ?? it.id ?? null;
    const th = it.th ?? it.city_name ?? it.name ?? '';
    const en = it.en ?? it.name_en ?? '';
    const nameTH = String(th || en || '');
    const nameEN = String(en || th || '');
    return {
      id: id != null ? String(id) : '',
      th: nameTH,
      en: nameEN,
      norm_th: normalize(nameTH),
      norm_en: normalize(nameEN),
    };
  }).filter(x => x.id && (x.th || x.en));
  return CACHE;
}

function search(list, q, limit) {
  const useThai = hasThai(q);
  const nq = normalize(q);
  const starts = [];
  const contains = [];

  for (const it of list) {
    const norm = useThai ? it.norm_th : it.norm_en;
    if (!norm) continue;
    if (norm.startsWith(nq)) {
      starts.push(it);
      if (starts.length >= limit) break;
    }
  }
  if (starts.length < limit) {
    for (const it of list) {
      const norm = useThai ? it.norm_th : it.norm_en;
      if (!norm) continue;
      if (!norm.startsWith(nq) && norm.includes(nq)) {
        contains.push(it);
        if (starts.length + contains.length >= limit) break;
      }
    }
  }

  const picked = [...starts, ...contains].slice(0, limit);
  return picked.map(it => ({
    type: 'City',
    city_id: it.id,
    city_name: useThai ? (it.th || it.en) : (it.en || it.th),
    subtitle: 'เมือง',
  }));
}

export default function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    }
    const q = String((req.query && req.query.q) || '').trim();
    const limitQ = parseInt(String((req.query && req.query.limit) || '10'), 10);
    const limit = Number.isFinite(limitQ) ? Math.max(1, Math.min(limitQ, MAX_LIMIT)) : 10;

    if (!q) return res.status(200).json({ ok: true, items: [] });

    const cities = loadCities();
    const items = search(cities, q, limit);

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error('city-suggest error:', err);
    return res.status(200).json({ ok: false, reason: 'internal_error' });
  }
}
