// api/suggest.js
// Robust suggest endpoint with resilient city data loading + in-memory cache

export const config = {
  runtime: "edge", // เร็ว และเพียงพอสำหรับงานอ่าน JSON
};

const DEFAULT_DATA_URL =
  "https://raw.githubusercontent.com/osophasin-ctrl/click-and-go/main/data/cities_min.json";

let memoryCache = {
  loadedAt: 0,
  items: null,
};

async function loadCityData() {
  // ใช้ cache ถ้ายังไม่เกิน 15 นาที
  const FIFTEEN_MIN = 15 * 60 * 1000;
  if (memoryCache.items && Date.now() - memoryCache.loadedAt < FIFTEEN_MIN) {
    return memoryCache.items;
  }

  const sources = [];
  // 1) ใช้ ENV ถ้ากำหนด (เช่น https://clickandgo.asia/data/cities_min.json)
  if (process.env.CITY_DATA_URL) {
    sources.push(process.env.CITY_DATA_URL);
  }
  // 2) ลองไฟล์บนโดเมนโปรดักชันโดยตรง (กันกรณี ENV ไม่ได้ตั้ง)
  sources.push("https://clickandgo.asia/data/cities_min.json");
  // 3) Fallback GitHub Raw (อ่านได้แน่)
  sources.push(DEFAULT_DATA_URL);

  let lastErr = null;

  for (const url of sources) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
      const data = await res.json();

      // normalize ให้กลายเป็น array ของ { id, name, countryId, raw }
      const items = Array.isArray(data) ? data : data.items || data.cities || [];
      const normalized = items
        .map((x) => {
          // รองรับหลายโครงสร้าง
          const id =
            x.city_id ?? x.cityId ?? x.id ?? x.CityId ?? x.CityID ?? null;

          const nameTH =
            x.city_name_th ?? x.city_name ?? x.name_th ?? x.nameTh ?? null;
          const nameEN =
            x.city_name_en ?? x.name_en ?? x.nameEn ?? x.english_name ?? null;

          const name =
            (typeof nameTH === "string" && nameTH.trim()) ||
            (typeof nameEN === "string" && nameEN.trim()) ||
            (typeof x.name === "string" && x.name.trim()) ||
            null;

          const countryId = x.country_id ?? x.countryId ?? x.CountryId ?? null;

          if (!id || !name) return null;

          return {
            id: String(id),
            name: String(name),
            countryId: countryId != null ? String(countryId) : null,
            raw: x,
          };
        })
        .filter(Boolean);

      memoryCache = { loadedAt: Date.now(), items: normalized };
      return normalized;
    } catch (err) {
      lastErr = err;
      // ลองแหล่งถัดไป
    }
  }

  throw lastErr || new Error("Unable to load city dataset from all sources.");
}

function searchCities(items, q, limit = 15) {
  const query = (q || "").toString().trim().toLowerCase();
  if (!query) return [];

  // tokenize เบา ๆ
  const qTokens = query.split(/\s+/).filter(Boolean);

  // ให้คะแนนจากการแมตช์ชื่อ
  const scored = items
    .map((it) => {
      const name = it.name.toLowerCase();
      let score = 0;
      for (const t of qTokens) {
        if (name === t) score += 5; // ตรงเป๊ะ
        else if (name.startsWith(t)) score += 3;
        else if (name.includes(t)) score += 1;
      }
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ it }) => ({
      cityId: it.id,
      cityName: it.name,
      countryId: it.countryId,
    }));

  return scored;
}

export default async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query") || searchParams.get("q") || "";

    // โหลดข้อมูลเมือง (มี cache)
    const items = await loadCityData();

    const results = searchCities(items, query, 20);

    // กัน cache ที่ edge/CDN
    const headers = new Headers();
    headers.set("Cache-Control", "no-store, max-age=0");

    return new Response(
      JSON.stringify({ ok: true, items: results }),
      { status: 200, headers }
    );
  } catch (err) {
    const headers = new Headers();
    headers.set("Cache-Control", "no-store, max-age=0");
    return new Response(
      JSON.stringify({ ok: false, error: String(err && err.message || err) }),
      { status: 500, headers }
    );
  }
};
