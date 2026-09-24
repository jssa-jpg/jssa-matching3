// resend-inbound.js
// Resendの「Receiving（受信メール）」Webhookを受け取り、
// 会員からの「会いたい企業」返信メールをAIで自動解析して「会いたいリクエスト」シートに登録する。
//
// 前提：
// - admin-api.js の sendCompanyNames で、企業名案内メールの reply_to を
//   reply+<バッチID>@<INBOUND_REPLY_DOMAIN> に設定している
// - Resend側で INBOUND_REPLY_DOMAIN のMXレコードを設定し、Receivingを有効化済み
// - Resend Webhooks画面で、このFunctionのURL（例: https://<サイト>.netlify.app/.netlify/functions/resend-inbound）を
//   event: email.received で登録し、発行された signing secret を RESEND_WEBHOOK_SECRET に設定済み

const crypto = require('crypto');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OFFICE_EMAIL = 'tok@yumeplanning.jp';
const OFFICE_FROM = 'tok@yumeplanning.jp';

// ---- Google Sheets 認証・操作（他Functionと同じ方式） ----
async function getToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })).toString('base64url');
  const si = `${h}.${p}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(si);
  const sig = sign.sign(sa.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${si}.${sig}`;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const data = await res.json();
  if (!data.access_token) throw new Error('Googleトークン取得失敗: ' + JSON.stringify(data));
  return data.access_token;
}

async function getSheet(token, name) {
  const id = process.env.GOOGLE_SHEET_ID;
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(name)}`, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  return data.values || [];
}

async function appendRow(token, sheetName, values) {
  const id = process.env.GOOGLE_SHEET_ID;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=RAW`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] })
  });
}

// ---- Resend(Svix)のWebhook署名検証 ----
function verifySvixSignature(rawBody, headers, secret) {
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatureHeader = headers['svix-signature'];
  if (!id || !timestamp || !signatureHeader) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false; // 5分以上ずれていたら拒否（リプレイ対策）

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  return signatureHeader.split(' ').some(part => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'base64'), Buffer.from(expected, 'base64'));
    } catch (e) {
      return false;
    }
  });
}

function extractEmailAddress(fromField) {
  const m = (fromField || '').match(/<([^>]+)>/);
  return (m ? m[1] : (fromField || '')).trim().toLowerCase();
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 引用元（元メールの本文が下に付いてくる部分）をできるだけ除去し、返信本文だけに絞る
function trimQuotedText(text) {
  const markers = [
    /^-{2,}\s*Original Message\s*-{2,}/mi,
    /^On .{0,80}wrote:$/mi,
    /^\d{4}年\d{1,2}月\d{1,2}日.{0,40}さんは書きました[：:]?/m,
    /^>{1,}/m,
    /^(From|差出人)\s*[:：]/m,
    /^_{5,}/m,
    /日本スタートアップ支援協会（JSSA）の岡隆宏です。/,
  ];
  let cutIndex = text.length;
  for (const re of markers) {
    const m = text.match(re);
    if (m && typeof m.index === 'number' && m.index < cutIndex) cutIndex = m.index;
  }
  return text.slice(0, cutIndex).trim();
}

// 返信に引用された元メールから「1. 会社名」形式の行を抽出する
function extractNumberedList(text) {
  // 元メールの一覧部分（【マッチング企業一覧】以降）があればそこから抽出。返信本文側の「2. ○○でお願いします」を拾わないため
  const src = text || '';
  const idx = src.lastIndexOf('【マッチング企業一覧】');
  const target = idx >= 0 ? src.slice(idx) : src;
  const map = new Map();
  const re = /^[\s>]*(\d{1,2})\s*[\.．、)）]\s*(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(target)) !== null) {
    const no = parseInt(m[1], 10);
    const name = m[2].trim();
    if (!name || /^会社概要|^推薦理由/.test(name)) continue;
    map.set(no, name); // 同じ番号が複数あれば後ろ（引用された元メール側）を優先
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([no, name]) => ({ no, name }));
}

async function extractCompaniesWithAI(candidateCompanies, subject, bodyText, numberedList) {
  if (!ANTHROPIC_API_KEY || candidateCompanies.length === 0) {
    return { companies: [], noneRequested: false, note: 'AI未設定、または候補企業なし' };
  }
  const prompt = `あなたはJSSA（日本スタートアップ支援協会）のメール返信を解析するアシスタントです。
以下は、会員に送った「マッチング企業のご案内」メールへの返信メール本文です。
会員は、面談・情報交換を希望する企業の「会社名」を返信に書いています（該当なしの場合もあります）。

【候補企業（この中からだけ選ぶ）】
${candidateCompanies.map(c => `・${c}`).join('\n')}

【元メールでの番号付き一覧（返信に引用された元メールから抽出。番号で指定された場合はこの番号で解釈する）】
${numberedList.length > 0 ? numberedList.map(n => `${n.no}. ${n.name}`).join('\n') : '（抽出できませんでした）'}

【返信メール本文】
${bodyText.slice(0, 3000)}

上記の企業一覧の中から、返信メールで面談を希望していると読み取れる企業名だけを、一覧の表記そのままで抽出してください。
表記ゆれ（全角/半角、株式会社の有無、スペースなど）があっても、候補企業の中から対応する会社を選んでください。
会社名が書かれている場合は会社名を最優先してください。番号だけで指定されている場合は、上の「元メールでの番号付き一覧」の番号で解釈してください。
一覧にない企業名を新しく作らないでください。
「該当なし」「今回は見送り」「希望する企業がない」など、希望企業がないという趣旨の返信の場合は none_requested を true にしてください。
判断に迷う場合は無理に含めず、空配列のままにしてください。

以下のJSON形式のみで出力してください。前置きや説明文は不要です。
{"companies":["会社名1","会社名2"],"none_requested":false}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    const text = (data.content && data.content[0] ? data.content[0].text : '').trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const companiesSet = new Set(candidateCompanies);
    const matched = (parsed.companies || []).filter(c => companiesSet.has(c));
    return { companies: matched, noneRequested: !!parsed.none_requested, note: '' };
  } catch (e) {
    console.error('AI抽出エラー:', e.message);
    return { companies: [], noneRequested: false, note: 'AI解析エラー: ' + e.message };
  }
}

async function sendOfficeMail(subject, text) {
  if (!RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: OFFICE_FROM,
        to: [OFFICE_EMAIL],
        subject,
        text,
        html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.8;">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')}</div>`
      })
    });
  } catch (e) {
    console.error('通知メール送信エラー:', e.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const hdrs = event.headers || {};

  if (RESEND_WEBHOOK_SECRET) {
    const ok = verifySvixSignature(rawBody, hdrs, RESEND_WEBHOOK_SECRET);
    if (!ok) {
      console.error('Webhook署名検証に失敗しました');
      return { statusCode: 401, body: 'Invalid signature' };
    }
  } else {
    console.warn('RESEND_WEBHOOK_SECRET未設定のため署名検証をスキップしています');
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  // 受信イベント以外、またResendの疎通確認リクエストは200を返して終了
  if (payload.type !== 'email.received') {
    return { statusCode: 200, body: 'ignored' };
  }

  try {
    const emailId = payload.data.email_id;
    const fromRaw = payload.data.from || '';
    const toList = payload.data.to || [];
    const subject = payload.data.subject || '';
    const fromEmail = extractEmailAddress(fromRaw);

    // 1. 受信メール本文を取得（Webhook自体には本文が含まれないため別途API呼び出しが必要）
    const emailRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` }
    });
    const email = await emailRes.json();
    const rawText = email.text || stripHtml(email.html || '');
    const bodyText = trimQuotedText((rawText || '').trim());

    if (!fromEmail) {
      console.log('送信元メールアドレスを取得できませんでした');
      return { statusCode: 200, body: 'skipped(no from)' };
    }
    if (!bodyText) {
      console.log('本文が空のためスキップ:', fromEmail);
      return { statusCode: 200, body: 'skipped(empty body)' };
    }

    const token = await getToken();

    // 2. 重複処理防止：同じメールを既に処理済みでないか確認
    const existingRequests = await getSheet(token, '会いたいリクエスト');
    const alreadyProcessed = existingRequests.some(r => `${r[11] || ''}${r[12] || ''}`.includes(`[mail:${emailId}]`));
    if (alreadyProcessed) {
      console.log('既に処理済みのメールです:', emailId);
      return { statusCode: 200, body: 'duplicate, skipped' };
    }

    // 3. どのマッチング結果への返信かを特定する
    //    優先1: 宛先が reply+<バッチID>@... 形式ならバッチIDで直接特定
    //    優先2: 送信元メールアドレスから、最後に「企業名送信済み」となったバッチを探す
    const matchRows = await getSheet(token, 'マッチング結果');
    let targetBatchId = null;
    for (const to of toList) {
      // 注意：base64urlは大文字・小文字を区別するため、ここでは小文字化しない
      const mAngle = String(to || '').match(/<([^>]+)>/);
      const addr = (mAngle ? mAngle[1] : String(to || '')).trim();
      const m = addr.match(/^reply\+([^@]+)@/i);
      if (m) {
        const tokenPart = m[1];
        // 1) そのままデコードしてバッチIDを照合
        let decoded = null;
        try { decoded = Buffer.from(tokenPart, 'base64url').toString('utf8'); } catch (e) { decoded = null; }
        if (decoded && matchRows.slice(1).some(r => r[0] === decoded)) {
          targetBatchId = decoded;
        } else {
          // 2) メール経路で小文字化された場合に備え、シート上の各バッチIDをエンコードし、大文字・小文字を無視して照合
          const lowerToken = tokenPart.toLowerCase();
          const hit = matchRows.slice(1).find(r => r[0] && Buffer.from(String(r[0])).toString('base64url').toLowerCase() === lowerToken);
          targetBatchId = hit ? hit[0] : decoded;
        }
        console.log('返信先トークンから特定したバッチID:', targetBatchId);
        break;
      }
    }

    let batchRows;
    if (targetBatchId) {
      batchRows = matchRows.slice(1).filter(r => r[0] === targetBatchId);
    } else {
      const byEmail = matchRows.slice(1).filter(r => (r[5] || '').trim().toLowerCase() === fromEmail && r[8] === '企業名送信済み');
      if (byEmail.length > 0) {
        const latest = byEmail.reduce((a, b) => (a[1] || '') >= (b[1] || '') ? a : b);
        targetBatchId = latest[0];
        batchRows = byEmail.filter(r => r[0] === targetBatchId);
      } else {
        batchRows = [];
      }
    }

    if (batchRows.length === 0) {
      console.log('対応するマッチング結果が見つかりません:', fromEmail, targetBatchId);
      await sendOfficeMail(
        `【要確認】対応するマッチング結果が見つからない返信（${fromEmail}）`,
        `件名「${subject}」のメールが ${fromEmail} から届きましたが、対応する「企業名送信済み」のマッチング結果が見つかりませんでした。\nお手数ですが内容をご確認のうえ、必要であれば管理画面から手動で登録してください。\n\n---本文---\n${bodyText.slice(0, 1500)}`
      );
      return { statusCode: 200, body: 'no matching batch' };
    }

    // 候補は実際にメールで案内した「企業名送信済み」の企業に限定する（未案内の企業が誤って選ばれるのを防ぐ）
    const sentRows = batchRows.filter(r => r[8] === '企業名送信済み');
    const candidateCompanies = [...new Set((sentRows.length > 0 ? sentRows : batchRows).map(r => r[6]).filter(Boolean))];
    const numberedList = extractNumberedList(rawText);
    const userId = batchRows[0][2] || '';
    const userCompany = batchRows[0][3] || '';
    const userName = batchRows[0][4] || '';
    const userEmail = batchRows[0][5] || fromEmail;

    // 4. AIでメール本文から希望企業を抽出
    const extraction = await extractCompaniesWithAI(candidateCompanies, subject, bodyText, numberedList);

    if (extraction.noneRequested || extraction.companies.length === 0) {
      await sendOfficeMail(
        `【返信あり】${userCompany || ''}${userName || ''}様から返信（${extraction.noneRequested ? '該当なし' : '企業名を自動検出できず'}）`,
        `会員から返信がありましたが、${extraction.noneRequested ? '「該当なし」等、希望企業がない旨の返信でした。' : 'AIが企業名を自動検出できませんでした。内容をご確認のうえ、必要であれば管理画面から手動登録してください。'}\n\n会員：${userCompany} ${userName}（${userEmail}）\n\n---元の返信メール---\n${bodyText.slice(0, 1500)}\n\n${extraction.note || ''}`
      );
      return { statusCode: 200, body: 'no companies requested' };
    }

    // 5. 「会いたいリクエスト」シートに1社ずつ登録（既存の管理画面フローにそのまま乗せる）
    const now = new Date().toISOString();
    const marker = `[mail:${emailId}]`;
    for (const company of extraction.companies) {
      const requestId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await appendRow(token, '会いたいリクエスト', [
        requestId, userId, company, '', 'リクエスト受付', now, now,
        userCompany, userName, userEmail,
        bodyText.slice(0, 2000),
        '',
        `🤖 AIがメール返信を自動解析して登録しました（要確認）。${marker}`
      ]);
    }

    // 6. 岡代表へ通知
    await sendOfficeMail(
      `【自動検出】${userCompany || ''}${userName || ''}様から会いたい企業の返信（${extraction.companies.length}社）`,
      `会員からの返信メールをAIが自動解析し、以下の企業を「会いたいリクエスト」に登録しました。\n（ステータス：未処理・要確認）\n\n■ 会員\n${userCompany} ${userName} 様\n${userEmail}\n\n■ 検出した企業\n${extraction.companies.map(c => '・' + c).join('\n')}\n\n■ 元の返信メール\n${bodyText.slice(0, 1000)}\n\n────────────────\n管理画面の「ユーザー返信」タブで内容を確認し、問題なければ担当者の選定と推薦メールの送信を行ってください。`
    );

    return { statusCode: 200, body: JSON.stringify({ success: true, detected: extraction.companies }) };
  } catch (e) {
    console.error('resend-inbound エラー:', e.message);
    try { await sendOfficeMail('【エラー】返信メール自動処理に失敗', `resend-inbound Functionでエラーが発生しました:\n${e.message}`); } catch (_) {}
    // Resendにエラーを返すとリトライされ続けるため、内部エラーは200で受け取り済みとして扱う
    return { statusCode: 200, body: 'error handled' };
  }
};
