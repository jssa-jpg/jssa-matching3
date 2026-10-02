// 動作状況の確認用（読み取り専用・個人情報なし）
// GET  : システムログの最新行、マッチング結果の最新バッチの件数、名刺データのAI分類の進み具合を返す
// POST : 画面側で起きたエラーをシステムログに記録する（{fn, userId, message}）
const { appendSystemLog, LOG_SHEET, getParticipants, getIntroducedCompanies } = require('./sheets-helper');

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
    const qs = event.queryStringParameters || {};
    if (qs.batchUser) {
      // ある会員のマッチング結果（最新、または日時の先頭一致）の会社名を並び順どおりに返す（会社名・スコア・ステータスのみ）
      const tk1 = await token();
      const mr1 = (await values(tk1, 'マッチング結果!A:K')) || [];
      const rows1 = mr1.slice(1).filter(r => r[2] === qs.batchUser);
      const ids = [...new Set(rows1.map(r => r[0]))];
      const pickId = qs.at ? ids.find(id => rows1.find(r => r[0] === id && jst(r[1]).startsWith(qs.at))) : ids[ids.length - 1];
      const br = rows1.filter(r => r[0] === pickId);
      const order = []; const seen = new Map();
      br.forEach((r, i) => { const c = String(r[6] || ''); if (!seen.has(c)) { seen.set(c, { 順位: order.length + 1, 会社名: c, 行数: 0, 最初の行: i + 1, スコア: r[7] }); order.push(c); } seen.get(c).行数++; });
      const core = v => String(v || '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase().replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|有限責任|\(株\)|㈱/g, '');
      const byCore = {}; order.forEach(c => { const k = core(c); (byCore[k] = byCore[k] || []).push(c); });
      const stc = {}; br.forEach(r => { const k = r[8] || '未通知'; stc[k] = (stc[k] || 0) + 1; }); const sentCos = [...new Set(br.filter(r => r[8] === '企業名送信済み').map(r => r[6]))];
      return { statusCode: 200, headers, body: JSON.stringify({ バッチ日時: br[0] ? jst(br[0][1]) : '', ステータス内訳: stc, 送信済みの会社: sentCos, 行数: br.length, 会社数: order.length, 表記ゆれの疑い: Object.values(byCore).filter(a => a.length > 1), 会社一覧: order.map(c => seen.get(c)) }, null, 1) };
    }
    if (qs.company) {
      // 会社名の一部で名刺を探し、属性・業種詳細・URL有無と、指定会員に案内済みかどうかを返す（氏名・連絡先は返さない）
      const kw = String(qs.company).normalize('NFKC').toLowerCase();
      const all = await getParticipants();
      const hits = all.filter(p => String(p.company).normalize('NFKC').toLowerCase().includes(kw)).slice(0, 40);
      let introduced = [];
      if (qs.user) { try { introduced = await getIntroducedCompanies(qs.user); } catch (e) {} }
      const n = v => String(v || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
      const intro = new Set(introduced.map(n));
      let history = [];
      if (qs.user) {
        const tk0 = await token();
        const mr0 = await values(tk0, 'マッチング結果!A:I');
        history = (mr0 || []).slice(1).filter(r => r[2] === qs.user && String(r[6] || '').normalize('NFKC').toLowerCase().includes(kw) && (r[8] === '企業名送信済み' || r[8] === '除外')).map(r => ({ バッチ日時: jst(r[1]), ステータス: r[8] }));
      }
      return { statusCode: 200, headers, body: JSON.stringify({ 件数: hits.length, この会員への案内履歴: history, 名刺: hits.map(p => ({ 会社名: p.company, 部署: p.department, 役職: p.position, 属性: p.attribute, 業種詳細: p.industryDetail, 地域: p.prefecture, URLあり: !!(p.siteUrl && p.siteUrl !== '不明'), URL: p.siteUrl || '', 企業特徴: p.features || '', 案内済み: intro.has(n(p.company)) })) }, null, 1) };
    }
    if ((event.queryStringParameters || {}).selftest) { await appendSystemLog('selftest', '', 'OK', 0, 'ログ書き込みテスト'); }
    const tk = await token();
    const [log, mr, cards] = await Promise.all([values(tk, LOG_SHEET), values(tk, 'マッチング結果!A:I'), values(tk, '名刺データ!A:A').then(async a => ({ a, aj: await values(tk, '名刺データ!AJ:AJ'), m: await values(tk, '名刺データ!M:M') }))]);
    const batches = new Map();
    (mr || []).slice(1).forEach(r => {
      const id = r[0] || ''; if (!id) return;
      if (!batches.has(id)) batches.set(id, { 日時: jst(r[1]), ユーザーID: r[2] || '', 行数: 0, ステータス: {} });
      const b = batches.get(id); b.行数++; const st = r[8] || '未通知'; b.ステータス[st] = (b.ステータス[st] || 0) + 1;
    });
    const latest = [...batches.values()].sort((a, b) => b.日時.localeCompare(a.日時)).slice(0, 10);
    const cardRows = (cards.a || []).slice(1).filter(r => r[0]).length;
    const classified = (cards.aj || []).slice(1).filter(r => r[0]).length;
    const attrDist = {};
    (cards.aj || []).slice(1).forEach((r, i) => { const k = String(r[0] || '（未分類）'); const u = String(((cards.m || [])[i + 1] || [])[0] || '').trim(); const ok = u && u !== '不明'; attrDist[k] = attrDist[k] || { 件数: 0, URLあり: 0 }; attrDist[k].件数++; if (ok) attrDist[k].URLあり++; });
    const body = {
      属性の内訳: attrDist,
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
