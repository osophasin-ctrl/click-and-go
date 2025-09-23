// /api/search.js
// รับ query จาก frontend แล้วดึงผลโรงแรมจาก Agoda API

import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const {
      q = '',
      cityId,
      checkin,
      checkout,
      rooms = 1,
      adults = 2,
      children = 0,
      lang = 'th-th',
      currency = 'THB',
      page = 1,
      limit = 30
    } = req.query;

    // ✅ ใช้ cityId ที่ส่งมาจาก suggest.js
    const searchPayload = {
      cityId: cityId ? Number(cityId) : undefined,
      query: q || undefined,
      checkIn: checkin,
      checkOut: checkout,
      rooms: Number(rooms),
      adults: Number(adults),
      children: Number(children),
      currency,
      language: lang,
      pageNumber: Number(page),
      pageSize: Number(limit)
    };

    // เรียก Agoda Lite API
    const url = 'https://affiliateapi7643.agoda.com/affiliateservice/lt_v1/search'; 
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `${process.env.AGODA_SITE_ID}:${process.env.AGODA_API_KEY}`
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Agoda API Error:', text);
      return res.status(500).json({ ok: false, error: 'agoda_api_failed', detail: text });
    }

    const data = await response.json();

    // ✅ map ข้อมูลให้ frontend ใช้งานง่าย
    const results = (data?.hotels || []).map(h => ({
      hotelId: h.hotelId,
      name: h.name,
      city: h.city,
      price: h.lowRate || 0,
      currency: h.currency,
      rating: h.rating,
      reviewScore: h.reviewScore,
      thumbnail: h.thumbnailUrl || '',
      url: h.deepLink || ''
    }));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      total: data?.total || results.length,
      results
    });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
