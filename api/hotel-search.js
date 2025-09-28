// /api/hotel-search.js — คืน hotel_id จากชื่อโรงแรม (อ่านชาร์ดจาก /public/hotel-index)
const zlib = require("zlib");
const crypto = require("crypto");

const SHARDS = 64; // ต้องตรงกับตอน build

function guessProto(req) {
  return (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
}
function hostOrigin(req) {
  const proto = guessProto(req);
  const host = req.headers.host;
  return `${proto}://${host}`;
}

// normalize ชื่อ
const punct = /[.,(){}\[\]'\"’“”\-_/]+/g;
const space = /\s+/g;
function normEn(s){ return String(s||"").trim().replace(punct," ").replace(space," ").toLowerCase(); }
function normTh(s){ return String(s||"").trim().replace(punct," ").replace(space," "); }

// ให้ชาร์ดเดียวกับตอน build (md5 % 64 → 00..3f)
function shardCode(qn){
  const n = parseInt(crypto.createHash("md5").update(qn).digest("hex").slice(0,8), 16) % SHARDS;
  return n.toString(16).padStart(2,"0");
}

module.exports = async function (req, res) {
  try {
    const q = (req.query.q || "").toString();
    const lang = (req.query.lang || "en").toString().toLowerCase() === "th" ? "th" : "en";
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 50);
    if (!q) return res.status(400).json({ ok:false, items:[], reason:"missing_q" });

    const qn = lang === "en" ? normEn(q) : normTh(q);
    const code = shardCode(qn);

    const base = hostOrigin(req); // เช่น https://www.clickandgo.asia
    const url = `${base}/hotel-index/${lang}/shard/${code}.jsonl.gz`;

    const r = await fetch(url);
    if (!r.ok) return res.status(200).json({ ok:true, items:[] });

    // แตก gzip แล้วไล่อ่านทีละบรรทัด
    const buf = Buffer.from(await r.arrayBuffer());
    const text = zlib.gunzipSync(buf).toString("utf-8");

    const out = [];
    const words = qn.split(" ").filter(Boolean);
    for (const line of text.split("\n")) {
      if (!line) continue;
      const rec = JSON.parse(line); // {hotel_id, name, name_norm}
      const hay = rec.name_norm || "";
      if (words.every(w => hay.includes(w))) {
        out.push({ hotel_id: String(rec.hotel_id), label: rec.name, type: "hotel" });
        if (out.length >= limit) break;
      }
    }
    return res.status(200).json({ ok:true, items: out });
  } catch (e) {
    return res.status(200).json({ ok:false, items:[], reason: "exception", message: String(e) });
  }
};
