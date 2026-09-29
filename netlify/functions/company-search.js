// マッチングアンケート冒頭の「紹介してほしい会社名」検索
// 名刺データに登録されている会社名だけを返す（部署・氏名・連絡先などは返さない）
const { getParticipants } = require('./sheets-helper');
const rate = new Map();
const norm = v => String(v || '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();
// 法人格を除いた比較用の名前（「株式会社」の有無や位置の違いで見つからないのを防ぐ）
const core = v => norm(v).replace(/株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|有限責任|\(株\)|㈱/g, '');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json; charset=utf-8' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  const ip = (event.headers['x-forwarded-for'] || 'unknown').split(',')[0];
  const now = Date.now(); const r = rate.get(ip) || { n: 0, reset: now + 60000 };
  if (now > r.reset) { r.n = 0; r.reset = now + 60000; } r.n++; rate.set(ip, r);
  if (r.n > 30) return { statusCode: 429, headers, body: JSON.stringify({ error: '検索が多すぎます。1分ほどおいてお試しください。' }) };
  try {
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : (event.queryStringParameters || {});
    const q = core(body.q);
    if (q.length < 2) return { statusCode: 400, headers, body: JSON.stringify({ error: '会社名を2文字以上入力してください。' }) };
    const all = await getParticipants();
    const names = new Map();
    for (const p of all) {
      const c = String(p.company || '').trim(); if (!c) continue;
      const k = norm(c); if (names.has(k)) continue;
      if (core(c).includes(q)) names.set(k, c);
    }
    // 完全一致・前方一致を先に並べる
    const list = [...names.values()].sort((a, b) => {
      const sa = core(a) === q ? 0 : core(a).startsWith(q) ? 1 : 2, sb = core(b) === q ? 0 : core(b).startsWith(q) ? 1 : 2;
      return sa - sb || a.length - b.length || a.localeCompare(b, 'ja');
    });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, total: list.length, companies: list.slice(0, 20) }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
