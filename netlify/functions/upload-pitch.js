// Upload pitch slide to Netlify Blobs
const { getStore } = require("@netlify/blobs");

const rateLimit = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimit.set(ip, entry);
  return entry.count <= 5; // 5回/分まで
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const ip = event.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "アップロード制限に達しました" }) };
  }

  try {
    const { company, name, fileName, fileType, base64 } = JSON.parse(event.body);

    // バリデーション
    if (!company || !name || !fileName || !base64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "必須パラメータが不足しています" }) };
    }

    // ファイル種別チェック
    const allowedTypes = ['application/pdf', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
    if (!allowedTypes.includes(fileType)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "PDF・PPT・PPTXファイルのみ対応しています" }) };
    }

    // サイズチェック（Base64は約1.33倍になるので10MBの1.33倍=13.3MB）
    if (base64.length > 14 * 1024 * 1024) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "ファイルサイズが大きすぎます" }) };
    }

    // Netlify Blobsに保存
    const store = getStore("jssa-pitches");
    // キー: company_name_timestamp でユニークに
    const sanitized = `${company}_${name}`.replace(/[^\w\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/g, '_').slice(0, 60);
    const key = `${sanitized}_${Date.now()}`;

    const payload = JSON.stringify({ fileName, fileType, base64, uploadedAt: new Date().toISOString() });
    await store.set(key, payload);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, key })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
