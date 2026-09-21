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

    const challengeInfo = user.mgmtChallenges?.length > 0
      ? `現在の経営課題: ${user.mgmtChallenges.join("、")}`
      : "";

    const prompt = `あなたはビジネスマッチングのプロフェッショナルアドバイザーです。

【ユーザー情報】
会社名: ${user.company} / 役職: ${user.position||"未入力"} / 氏名: ${user.name}
属性: ${user.attribute} / 参加目的: ${user.purpose.join("、")}
${user.currentRound ? "現在のラウンド: "+user.currentRound : ""}
${challengeInfo}
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
  "selfIntro": "${user.company}の${user.name}として相手に刺さる30秒自己紹介（100文字程度。${challengeInfo ? '経営課題「'+user.mgmtChallenges.join('・')+'」を具体的に盛り込むこと' : 'スタートアップの場合は現在の経営課題にも触れること'}）"
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });

    // レスポンスのステータスとテキストを確認
    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(`Anthropic API エラー (${response.status}): ${rawText.slice(0, 200)}`);
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch(parseErr) {
      throw new Error(`JSONパースエラー: ${rawText.slice(0, 200)}`);
    }

    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error(`APIレスポンス構造エラー: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const text = data.content[0].text;

    // JSONブロックを確実に抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`JSON抽出失敗: ${text.slice(0, 200)}`);

    let advice;
    try {
      advice = JSON.parse(jsonMatch[0]);
    } catch(e) {
      throw new Error(`JSONパース失敗: ${jsonMatch[0].slice(0, 200)}`);
    }

    // 必須フィールドの確認・補完
    const result = {
      matchDegree: advice.matchDegree || `マッチ度${match.score}%です。双方の目的や業種が一致しています。`,
      recommendation: advice.recommendation || '目的や業種が合致しており、有益な情報交換が期待できます。',
      firstWords: advice.firstWords || `${match.company}の${match.position}${match.name}さん、はじめまして。${user.company}の${user.name}と申します。本日はよろしくお願いいたします。`,
      selfIntro: advice.selfIntro || `${user.company}の${user.name}です。${user.purpose[0]||''}を目的に参加しております。ぜひお話しさせてください。`
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
