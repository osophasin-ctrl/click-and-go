// /api/health.js
export default function handler(req, res) {
  try {
    // ตัวอย่างข้อมูลสถานะระบบ (ปรับแต่งได้)
    const status = {
      ok: true,
      service: 'clickandgo-api',
      time: new Date().toISOString(),
      region: process.env.VERCEL_REGION || 'unknown',
    };

    // ป้องกัน cache
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(status);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Server error' });
  }
}
