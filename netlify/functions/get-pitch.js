// Get pitch slide from Netlify Blobs
const { getStore } = require("@netlify/blobs");

const rateLimit = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimit.set(ip, entry);
  return entry.count <= 20;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const ip = event.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "リクエストが多すぎます" }) };
  }

  try {
    const key = event.queryStringParameters?.key;
    if (!key) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "keyパラメータが必要です" }) };
    }

    const store = getStore("jssa-pitches");
    const stored = await store.get(key);

    if (!stored) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "スライドが見つかりません" }) };
    }

    const data = JSON.parse(stored);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        fileName: data.fileName,
        fileType: data.fileType,
        base64: data.base64,
        uploadedAt: data.uploadedAt
      })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
