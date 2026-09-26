// 動作状況の確認用（読み取り専用・個人情報なし）
// GET  : システムログの最新行、マッチング結果の最新バッチの件数、名刺データのAI分類の進み具合を返す
// POST : 画面側で起きたエラーをシステムログに記録する（{fn, userId, message}）
const { appendSystemLog, LOG_SHEET } = require('./sheets-helper');

async function token() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })}`;
  const sig = require('crypto').createSign('RSA-SHA256').update(input).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${input}.${sig}` });
  return (await r.json()).access_token;
}
async function values(tk, range) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${tk}` } });
  if (!r.ok) return null;
  return (await r.json()).values || [];
}
const jst = iso => { const t = Date.parse(iso); return isNaN(t) ? String(iso || '') : new Date(t + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19); };

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      await appendSystemLog(`画面:${String(b.fn || '').slice(0, 30)}`, String(b.userId || '').slice(0, 40), 'エラー', '', String(b.message || '').slice(0, 400));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }
    const tk = await token();
    const [log, mr, cards] = await Promise.all([values(tk, LOG_SHEET), values(tk, 'マッチング結果!A:I'), values(tk, '名刺データ!A:A').then(async a => ({ a, aj: await values(tk, '名刺データ!AJ:AJ') }))]);
    const batches = new Map();
    (mr || []).slice(1).forEach(r => {
      const id = r[0] || ''; if (!id) return;
      if (!batches.has(id)) batches.set(id, { 日時: jst(r[1]), ユーザーID: r[2] || '', 行数: 0, ステータス: {} });
      const b = batches.get(id); b.行数++; const st = r[8] || '未通知'; b.ステータス[st] = (b.ステータス[st] || 0) + 1;
    });
    const latest = [...batches.values()].sort((a, b) => b.日時.localeCompare(a.日時)).slice(0, 10);
    const cardRows = (cards.a || []).slice(1).filter(r => r[0]).length;
    const classified = (cards.aj || []).slice(1).filter(r => r[0]).length;
    const body = {
      確認日時: jst(new Date().toISOString()),
      システムログ_最新30件: log ? log.slice(1).slice(-30).reverse() : '（まだ記録なし）',
      マッチング結果_最新10バッチ: latest,
      マッチング結果_総バッチ数: batches.size,
      名刺データ: { 行数: cardRows, 属性分類済み: classified },
    };
    return { statusCode: 200, headers, body: JSON.stringify(body, null, 1) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
