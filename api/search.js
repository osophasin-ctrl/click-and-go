// api/search.js
export default async function handler(req, res) {
  try {
    const {
      q = "Bangkok",
      checkin,
      checkout,
      rooms = 1,
      adults = 2,
      children = 0,
      lang = "en-us",
      currency = "THB",
      max = 10,
      debug = 0,
    } = req.query;

    // ✅ โหลด API Key จาก Environment Variable (Vercel)
    const API_KEY = process.env.AGODA_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ ok: false, error: "Missing AGODA_API_KEY" });
    }

    // ✅ เตรียม body ตาม Agoda Affiliate Lite API
    const criteria = {
      cityName: q,
      checkIn: checkin,
      checkOut: checkout,
      rooms: Number(rooms),
      adults: Number(adults),
      children: Number(children),
      currency,
      language: lang,
      resultCount: Number(max),
      sortOrder: "PRICE",
    };

    // ✅ ยิง API จริงไปที่ Agoda
    const apiUrl = "http://affiliateapi7643.agoda.com/affiliateservice/lt_v1";
    let agodaResult = null;
    let source = "agoda";

    try {
      const apiRes = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Accept-Encoding": "gzip,deflate",
          Authorization: API_KEY, // ใช้ key ตรงจาก Vercel
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ criteria }),
      });

      if (!apiRes.ok) {
        throw new Error("Agoda API error " + apiRes.status);
      }

      agodaResult = await apiRes.json();
    } catch (e) {
      // ถ้า API ล้มเหลว fallback ไป mock data
      source = "mock";
      agodaResult = {
        total: 3,
        items: [
          {
            id: "52120188",
            name: "Bangkok Riverside Hotel",
            city: "Bangkok",
            starRating: 4,
            reviewScore: 8.7,
            reviewCount: 214,
            imageUrl:
              "https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop",
            priceFrom: 1290,
            currency: "THB",
            freeCancellation: true,
            mealPlan: "Breakfast included",
            deeplink: `https://www.agoda.com/partners/partnersearch.aspx?cid=1949420&city=${encodeURIComponent(
              q
            )}&checkIn=${checkin}&checkOut=${checkout}`,
          },
          {
            id: "52120199",
            name: "Bangkok Central Hotel",
            city: "Bangkok",
            starRating: 3,
            reviewScore: 8.0,
            reviewCount: 120,
            imageUrl:
              "https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?q=80&w=1200&auto=format&fit=crop",
            priceFrom: 990,
            currency: "THB",
            freeCancellation: false,
            mealPlan: "",
            deeplink: `https://www.agoda.com/partners/partnersearch.aspx?cid=1949420&city=${encodeURIComponent(
              q
            )}&checkIn=${checkin}&checkOut=${checkout}`,
          },
        ],
      };
    }

    res.status(200).json({
      ok: true,
      source,
      query: criteria,
      total: agodaResult?.total || agodaResult?.items?.length || 0,
      items: agodaResult?.items || [],
      ...(debug ? { _raw: JSON.stringify(agodaResult) } : {}),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
