// send-email.js - Resend APIを使用したメール送信 Function

const { getParticipants } = require('./sheets-helper');

const SEND_LIMITS = {
  "非会員": parseInt(process.env.LIMIT_NON_MEMBER || "20"),
  "スタートアップ会員": parseInt(process.env.LIMIT_STARTUP || "100"),
  "スポンサー会員": parseInt(process.env.LIMIT_SPONSOR || "100"),
  "サポート会員": parseInt(process.env.LIMIT_SUPPORT || "100"),
  "協会LP投資家": parseInt(process.env.LIMIT_LP || "100"),
  "協会メンター顧問": parseInt(process.env.LIMIT_MENTOR || "100"),
};

const sendCounts = new Map();
const rateLimit = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimit.set(ip, entry);
  return entry.count <= 10;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const ip = event.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "送信制限に達しました。しばらくお待ちください。" }) };
  }

  try {
    const { senderInfo, targetCompany, targetName, subject, message } = JSON.parse(event.body);

    // 送信上限チェック
    const memberType = senderInfo.memberType || "非会員";
    const limit = SEND_LIMITS[memberType] ?? 20;
    const countKey = `${senderInfo.company}_${senderInfo.name}`;
    const currentCount = sendCounts.get(countKey) || 0;

    if (currentCount >= limit) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: `送信上限（${limit}件）に達しました。`, limit, sent: currentCount })
      };
    }

    // 宛先メールアドレスをGoogleスプレッドシートから取得（個人情報はサーバー側のみ）
    const participants = await getParticipants();
    const target = participants.find(p =>
      p.company === targetCompany && p.name === targetName
    );

    if (!target || !target.email) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "送信先が見つかりません" }) };
    }

    const toEmail = target.email;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const OFFICE_EMAIL = process.env.RESEND_FROM_EMAIL || "tok@yumeplanning.jp";
    const OFFICE_NAME = "JSSA事務局（日本スタートアップ支援協会）";

    if (!RESEND_API_KEY) {
      sendCounts.set(countKey, currentCount + 1);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, demo: true, message: "デモモード：RESEND_API_KEYが未設定です", sent: currentCount + 1, limit })
      };
    }

    const htmlBody = `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <div style="background:#0B0F1A;padding:18px 24px;">
          <span style="background:#639922;color:#fff;font-weight:800;font-size:12px;padding:3px 10px;border-radius:4px;letter-spacing:.05em;">JSSA</span>
          <span style="color:#fff;font-size:14px;font-weight:500;margin-left:10px;">マッチングツール経由メッセージ</span>
        </div>
        <div style="padding:28px 24px;">
          <p style="color:#374151;font-size:14px;margin:0 0 16px;">
            ${targetName} 様<br><br>
            JSSAエコシステムマッチングツールを通じて、<strong>${senderInfo.company}</strong>の<strong>${senderInfo.name}</strong>様よりメッセージが届きました。
          </p>
          <div style="background:#F0F9E8;border-left:4px solid #639922;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:24px;">
            <p style="color:#1f2937;font-size:14px;line-height:1.9;margin:0;">${message.replace(/\n/g, '<br>')}</p>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <table style="font-size:13px;color:#374151;width:100%;border-collapse:collapse;">
            <tr><td style="padding:5px 0;font-weight:700;width:80px;color:#6b7280;">会社名</td><td style="padding:5px 0;">${senderInfo.company}</td></tr>
            <tr><td style="padding:5px 0;font-weight:700;color:#6b7280;">役職</td><td style="padding:5px 0;">${senderInfo.position || '—'}</td></tr>
            <tr><td style="padding:5px 0;font-weight:700;color:#6b7280;">氏名</td><td style="padding:5px 0;">${senderInfo.name}</td></tr>
            ${senderInfo.email ? `<tr><td style="padding:5px 0;font-weight:700;color:#6b7280;">メール</td><td style="padding:5px 0;"><a href="mailto:${senderInfo.email}" style="color:#1d4ed8;">${senderInfo.email}</a></td></tr>` : ''}
          </table>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
          <p style="font-size:11px;color:#9ca3af;margin:0;line-height:1.8;">
            ※このメールはJSSAエコシステムマッチングツール（jssa-matching2.jp）を通じて送信されました。<br>
            ※JSSA事務局（${OFFICE_EMAIL}）にもCCで送信されています。<br>
            ※返信は送信者に直接届きます。
          </p>
        </div>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `${OFFICE_NAME} <${OFFICE_EMAIL}>`,
        to: [toEmail],
        cc: [OFFICE_EMAIL],
        reply_to: senderInfo.email || OFFICE_EMAIL,
        subject: subject || `【JSSAマッチング】${senderInfo.company} ${senderInfo.name}よりご連絡`,
        html: htmlBody
      })
    });

    const resData = await res.json();

    if (!res.ok) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "メール送信に失敗しました: " + (resData.message || JSON.stringify(resData)) }) };
    }

    sendCounts.set(countKey, currentCount + 1);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, sent: currentCount + 1, limit, id: resData.id })
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
