// /api/search.js
export default function handler(req, res) {
  const { destination, checkin, checkout, guests } = req.query;

  // ตัวอย่าง mock data — จำลองผลลัพธ์การค้นหาโรงแรม
  const results = [
    {
      id: 1,
      name: "Bangkok Central Hotel",
      city: "Bangkok",
      price: 1200,
      currency: "THB",
      image: "https://images.unsplash.com/photo-1566073771259-6a8506099945",
      url: "https://www.agoda.com/",
    },
    {
      id: 2,
      name: "Chiang Mai Boutique Resort",
      city: "Chiang Mai",
      price: 1800,
      currency: "THB",
      image: "https://images.unsplash.com/photo-1551776235-dde6d4829808",
      url: "https://www.agoda.com/",
    },
  ];

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    query: { destination, checkin, checkout, guests },
    count: results.length,
    results,
  });
}
