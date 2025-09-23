// api/suggest.js
// Robust city suggest endpoint with cache + fallback

// ---- CONFIG ----
const FALLBACK_RAW_URL =
  "https://raw.githubusercontent.com/osophasin-ctrl/click-and-go/main/data/cities_min.json";

const MAX_ITEMS = 15;         // จำนวนรายการที่ส่งกลับสูงสุด
const CACHE_TTL_MS = 15 * 60 * 1000; // cache 15 นาที

// ---- SIMPLE MEMORY CACHE ----
let memoryCache = {
  loadedAt: 0,
  items: null, // array of { id, th, en, countryId }
};

// ---- HELPERS ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function norm(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

// Map เป็นโครงเดียวกับที่หน้าเว็บชอบใช้
function mapCity(c) {
  return {
    city_id: c.id,
    city_name: c.th,
    city_name_en: c.en,
    country_id: c.countryId,
    // เผื่อ component อื่น ๆ ใช้รูปแบบ label/value
    label: c.th || c.en,
    value: c.id,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function loadCityData(debug = false) {
  // ใช้ cache ถ้ายังไม่หมดอายุ
  const now = Date.now();
  if (memoryCache.items && now - memoryCache.loadedAt < CACHE_TTL_MS) return;

  const envUrl = process.env.CITY_DATA_URL;
  const firstUrl = envUrl && envUrl.trim() ? envUrl.trim() : FALLBACK_RAW_URL;

  try {
    if (debug) console.log("[suggest] fetching:", firstUrl);
    const json = await fetchJson(firstUrl);
    if (!Array.isArray(json)) throw new Error("Invalid city JSON");
    memoryCache.items = json;
    memoryCache.loadedAt = Date.now();
    if (debug) console.log("[suggest] loaded", json.length, "cities from first URL");
  } catch (e) {
    if (debug) console.error("[suggest] first URL failed:", e?.message || e);
    // ถ้าล่มและยังไม่ใช่ fallback ให้ลอง fallback
    if (firstUrl !== FALLBACK_RAW_URL) {
      if (debug) console.log("[suggest] retrying fallback:", FALLBACK_RAW_URL);
      await sleep(100); // กัน rate burst เล็กน้อย
      const json = await fetchJson(FALLBACK_RAW_URL);
      if (!Array.isArray(json)) throw new Error("Invalid fallback city JSON");
      memoryCache.items = json;
      memoryCache.loadedAt = Date.now();
      if (debug) console.log("[suggest] loaded", json.length, "cities from fallback");
    } else {
      // สุดท้าย ถ้ายังพัง ให้ตั้งเป็นอาเรย์ว่าง
      memoryCache.items = [];
      memoryCache.loadedAt = Date.now();
    }
  }
}

// ---- API HANDLER ----
export default async function handler(req, res) {
  // อนุญาต CORS แบบง่าย (ช่วยตอนทดสอบ)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const q = (req.query.query || req.query.q || "").toString().trim();
  const debug = req.query.debug === "1" || req.query.debug === "true";

  try {
    await loadCityData(debug);

    if (!q) {
      return res.status(200).json({ ok: true, items: [] });
    }

    const nq = norm(q);
    const items = memoryCache.items || [];

    // ถ้าผู้ใช้กรอกเป็นตัวเลข ลอง match id ตรง ๆ ก่อน
    let result = [];
    if (/^\d+$/.test(nq)) {
      const idNum = Number(nq);
      result = items.filter((c) => c.id === idNum).slice(0, MAX_ITEMS).map(mapCity);
    }

    // ถ้ายังว่าง ให้ค้นหาด้วยข้อความ (ไทย/อังกฤษ)
    if (result.length === 0) {
      result = items
        .filter((c) => {
          const th = norm(c.th);
          const en = norm(c.en);
          // match แบบ contains และให้คะแนนเริ่มต้นด้วยก่อน
          return (
            th.startsWith(nq) ||
            en.startsWith(nq) ||
            th.includes(nq) ||
            en.includes(nq)
          );
        })
        .slice(0, MAX_ITEMS)
        .map(mapCity);
    }

    if (debug) console.log(`[suggest] q="${q}" → ${result.length} results`);
    return res.status(200).json({ ok: true, items: result });
  } catch (e) {
    if (debug) console.error("[suggest] error:", e?.message || e);
    return res.status(200).json({ ok: true, items: [] }); // ส่งโครงเดียวกันเพื่อกันหน้าเว็บพัง
  }
}
