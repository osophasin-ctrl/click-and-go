// /api/check-key.js
export default function handler(req, res) {
  const key = process.env.AGODA_API_KEY || '';
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    hasKey: Boolean(key),              // true = มีค่าแล้ว
    length: key.length || 0,           // ความยาว (ไม่โชว์ค่าเต็ม)
    sample: key ? key.slice(0, 8) + '...' + key.slice(-4) : null // เฉพาะต้น/ท้ายไว้ตรวจสอบ
  });
}
