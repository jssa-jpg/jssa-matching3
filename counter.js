// AI Advice Generator - Netlify Function

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
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const ip = event.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "リクエストが多すぎます" }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };

  try {
    const { user, match } = JSON.parse(event.body);

    const roundInfo = match.currentRound ? `現在のラウンド: ${match.currentRound}` :
      match.wantRounds?.length > 0 ? `対象ラウンド: ${match.wantRounds.join("、")}` : "";

    const prompt = `あなたはビジネスマッチングのプロフェッショナルアドバイザーです。

【ユーザー情報】
会社名: ${user.company} / 役職: ${user.position||"未入力"} / 氏名: ${user.name}
属性: ${user.attribute} / 参加目的: ${user.purpose.join("、")}
${user.currentRound ? "現在のラウンド: "+user.currentRound : ""}
${user.wantRounds?.length > 0 ? "対象ラウンド: "+user.wantRounds.join("、") : ""}

【マッチング相手情報】
会社名: ${match.company} / 役職: ${match.position} / 氏名: ${match.name}
属性: ${match.attribute} / 業種: ${match.industries.join("、")}
${roundInfo}
概要: ${match.description}
マッチ度: ${match.score}% / マッチ理由: ${match.reasons.join("、")}

以下の4項目をJSON形式のみで返してください（前後の説明不要）：
{
  "matchDegree": "マッチ度${match.score}%の理由を2〜3文で説明",
  "recommendation": "なぜこの相手と会うべきかの推薦理由を2〜3文",
  "firstWords": "${match.company}の${match.position}${match.name}さんへの第一声（社名・役職・名前入り、100文字程度）",
  "selfIntro": "${user.company}の${user.name}として相手に刺さる30秒自己紹介（100文字程度）"
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] })
    });

    const data = await response.json();
    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, "").trim();
    const advice = JSON.parse(clean);

    return { statusCode: 200, headers, body: JSON.stringify(advice) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
