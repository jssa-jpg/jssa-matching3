let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

// 会員ランク別の月間紹介上限（岡代表が採択して送信した企業数でカウント）
const MONTHLY_LIMITS = { 'レギュラーライト': 1, 'レギュラー': 2, 'プライム': 5, 'ライト': 1, '特待生': 2, '投資先': 10, 'default': 3 };

async function getParticipants() {
  const now = Date.now();
  if (cachedData && (now - cacheTime) < CACHE_TTL) return cachedData;

  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const token = await getAccessToken(serviceAccount);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:Z`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);

  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];

  const participants = [];
  let pid = 1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const company    = clean(row[0]);
    const department = clean(row[1]);
    const position   = clean(row[2]);
    const name       = clean(row[3]);
    const email      = clean(row[4]);
    const zip        = clean(row[5]);
    const address    = clean(row[6]);
    const telOffice  = clean(row[7]);
    const telDept    = clean(row[8]);
    const telDirect  = clean(row[9]);
    const fax        = clean(row[10]);
    const mobile     = clean(row[11]);
    const siteUrl    = clean(row[12]);
    const cardDate   = clean(row[13]);
    const industry   = clean(row[14]);
    const scale      = clean(row[15]);
    const employees  = clean(row[16]);
    const founded    = clean(row[17]);
    const capital    = clean(row[18]);
    const listed     = clean(row[19]);
    const hiring     = clean(row[20]);
    const maHistory  = clean(row[21]);
    const features   = clean(row[22]);
    const facebook   = clean(row[23]);

    if (!company) continue;

    // 都道府県名のみ（先頭4文字・数字記号除去）
    const prefecture = address ? address.replace(/[0-9０-９\-－\s]/g, '').slice(0, 4) : '';
    // 表示用住所（先頭8文字・数字記号除去）
    const addressDisplay = address ? address.replace(/[0-9０-９\-－\s]/g, '').slice(0, 8) : '';

    const isListed = listed && listed !== '' && listed !== '未上場' && listed !== '-' && listed !== '－' && listed !== '未上場企業';

    let scaleClass = scale || '';
    if (!scaleClass && employees) {
      const empNum = parseInt(employees.replace(/[^0-9]/g, ''));
      if (!isNaN(empNum)) {
        if (empNum >= 500) scaleClass = 'EP';
        else if (empNum >= 50) scaleClass = 'MID';
        else scaleClass = 'SMB';
      }
    }

    participants.push({
      id: pid++,
      cardRow: i + 1,
      company, department, position,
      industry, scale: scaleClass, employees,
      founded, capital,
      listed: isListed ? listed : '',
      hiring, ma: maHistory,
      features: (features || '').slice(0, 300),
      prefecture, address: addressDisplay,
      name, email, siteUrl, facebook,
      telOffice, telDept, telDirect, fax, mobile, zip, cardDate,
      listingStatus: isListed ? '上場企業' : '未上場企業',
      employeeScale: scaleClass,
      wantAttribute: ['スタートアップ', '支援者'],
    });
  }

  cachedData = participants;
  cacheTime = now;
  return participants;
}

function getEmailMap(participants) {
  const map = {};
  for (const p of participants) {
    map[`${p.company}_${p.name}`] = p.email;
  }
  return map;
}

function clean(s) {
  if (!s) return '';
  return String(s).trim().replace(/[\r\n\t]+/g, ' ');
}

async function saveMatchHistory(userId, matches) {
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const token = await getAccessToken(serviceAccount);
    const now = new Date().toISOString();
    const yearMonth = now.slice(0, 7);
    const values = matches.map(m => [String(userId), m.company, now, m.score, m.requested ? "1" : "0", yearMonth]);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/%E3%83%9E%E3%83%83%E3%83%81%E3%83%B3%E3%82%B0%E5%B1%A5%E6%AD%B4%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
    );
  } catch (e) {
    console.error('saveMatchHistory error:', e.message);
  }
}

async function getMatchHistory(userId) {
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const token = await getAccessToken(serviceAccount);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/%E3%83%9E%E3%83%83%E3%83%81%E3%83%B3%E3%82%B0%E5%B1%A5%E6%AD%B4`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json();
    const rows = data.values || [];
    return rows.slice(1)
      .filter(r => r[0] === String(userId))
      .map(r => ({ company: r[1], date: r[2], score: r[3], requested: r[4] === "1" }));
  } catch (e) {
    console.error('getMatchHistory error:', e.message);
    return [];
  }
}

async function getMonthlyRequestCount(userId) {
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const token = await getAccessToken(serviceAccount);
    const yearMonth = new Date().toISOString().slice(0, 7);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/%E6%9C%88%E6%AC%A1%E3%83%AA%E3%82%AF%E3%82%A8%E3%82%B9%E3%83%88%E6%95%B0`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json();
    const rows = data.values || [];
    const row = rows.find(r => r[0] === String(userId) && r[1] === yearMonth);
    return row ? parseInt(row[2] || "0") : 0;
  } catch (e) {
    console.error('getMonthlyRequestCount error:', e.message);
    return 0;
  }
}

// 'YYYY-MM' 形式の2つの年月の差（月数）を計算する
function _monthDiff(fromYM, toYM) {
  const [fy, fm] = (fromYM || '').split('-').map(Number);
  const [ty, tm] = (toYM || '').split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return (ty - fy) * 12 + (tm - fm);
}

// 紹介可能残高は、アプリ1が使う「月次リクエスト数」（月ごとのリクエスト回数）とは別の「紹介残高」シートで管理する。
// 同じスプレッドシートをアプリ1と共有しているため、同じシートに別の意味の数字を書き込まないようにする。
// 列: A=ユーザーID, B=最終更新年月, C=紹介残高
const BALANCE_SHEET = '紹介残高';
const LEGACY_SHEET = '月次リクエスト数';

async function _getValues(token, sheetId, range) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  return { ok: res.ok, values: data.values || [] };
}

// 「紹介残高」シートが無ければ作成し、アプリ2の会員（ユーザー登録シートにいる会員）の残高を旧シートから引き継ぐ
async function _ensureBalanceSheet(token, sheetId) {
  const first = await _getValues(token, sheetId, BALANCE_SHEET);
  if (first.ok) return first.values;
  const createRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: BALANCE_SHEET } } }] })
  });
  if (!createRes.ok) {
    // 同時アクセスで既に作成済みの場合は読み直す
    const again = await _getValues(token, sheetId, BALANCE_SHEET);
    return again.values;
  }
  const users = (await _getValues(token, sheetId, 'ユーザー登録')).values.slice(1).map(r => String(r[0] || '').trim()).filter(Boolean);
  const userSet = new Set(users);
  const legacy = (await _getValues(token, sheetId, LEGACY_SHEET)).values.slice(1);
  const seeded = [];
  const seen = new Set();
  for (const r of legacy) {
    const uid = String(r[0] || '').trim();
    if (!userSet.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
    seeded.push([uid, r[1] || '', String(r[2] || '0')]);
  }
  const values = [BALANCE_HEADER, ...seeded];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(BALANCE_SHEET + '!A1')}?valueInputOption=RAW`, {
    method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  return values;
}

const BALANCE_HEADER = ['ユーザーID', '最終更新年月', '紹介残高', '会社名', '氏名', 'メール', '会員コース', '月間上限', '残高上限（2か月分）', '最終更新日時', '更新内容'];

function _nowJst() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

// ユーザー登録・招待コードシートから、会社名・氏名・メール・会員コースを取得する
async function _userMeta(token, sheetId, userId) {
  if (String(userId) === 'guest') return { company: '（未ログインの閲覧者）', name: '', email: '', rank: 'ゲスト' };
  const users = (await _getValues(token, sheetId, 'ユーザー登録')).values;
  const u = users.find(r => String(r[0] || '').trim() === String(userId)) || [];
  let rank = '';
  const invoice = String(u[1] || '').trim();
  if (invoice) {
    const codes = (await _getValues(token, sheetId, '招待コード')).values;
    const c = codes.find(r => String(r[0] || '').trim() === invoice);
    rank = c ? (c[6] || '') : '';
  }
  return { company: u[2] || '', name: u[4] || '', email: u[5] || '', rank };
}

// 残高行（B〜K列）をまとめて書き込む。行が無ければA列から追記する
async function _writeBalanceRow(token, sheetId, rows, userId, yearMonth, balance, limit, note) {
  const m = await _userMeta(token, sheetId, userId);
  const cap = limit * 2;
  const tail = [yearMonth, String(balance), m.company, m.name, m.email, m.rank || '（未設定）', String(limit), String(cap), _nowJst(), note];
  const rowIndex = rows.findIndex(r => r[0] === String(userId));
  if (rowIndex >= 0) {
    const range = `${BALANCE_SHEET}!B${rowIndex + 1}:K${rowIndex + 1}`;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [tail] }) });
  } else {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(BALANCE_SHEET + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [[String(userId), ...tail]] }) });
  }
}

// 見出しが旧形式（3列）なら新しい見出しに更新し、既存行の会社名などを補完する
async function _upgradeBalanceSheet(token, sheetId, rows) {
  if (rows.length && rows[0][3] === '会社名') return rows;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(BALANCE_SHEET + '!A1:K1')}?valueInputOption=RAW`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [BALANCE_HEADER] }) });
  for (let i = 1; i < rows.length; i++) {
    const uid = String(rows[i][0] || '').trim();
    if (!uid) continue;
    const m = await _userMeta(token, sheetId, uid);
    const limit = MONTHLY_LIMITS[m.rank] || MONTHLY_LIMITS['default'];
    const range = `${BALANCE_SHEET}!D${i + 1}:K${i + 1}`;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [[m.company, m.name, m.email, m.rank || '（未設定）', String(limit), String(limit * 2), _nowJst(), '会社名などを補完']] }) });
  }
  return (await _getValues(token, sheetId, BALANCE_SHEET)).values;
}

async function _readBalanceRows(token, sheetId) {
  const rows = await _ensureBalanceSheet(token, sheetId);
  return await _upgradeBalanceSheet(token, sheetId, rows);
}

// 会員の現在の紹介可能残高を取得する。未使用分は繰り越されるが、上限は「月次上限の2か月分」まで。
async function getUserBalance(userId, limit) {
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const token = await getAccessToken(serviceAccount);
    const yearMonth = new Date().toISOString().slice(0, 7);
    const cap = limit * 2;
    const rows = await _readBalanceRows(token, sheetId);
    const rowIndex = rows.findIndex(r => r[0] === String(userId));
    if (rowIndex < 0) {
      // 初回アクセス：今月分の上限をそのまま付与して記録
      await _writeBalanceRow(token, sheetId, rows, userId, yearMonth, limit, limit, `初回付与 +${limit}`);
      return limit;
    }
    const lastMonth = rows[rowIndex][1] || yearMonth;
    let balance = parseInt(rows[rowIndex][2] || '0');
    const months = _monthDiff(lastMonth, yearMonth);
    if (months > 0) {
      const before = balance;
      balance = Math.min(balance + limit * months, cap);
      await _writeBalanceRow(token, sheetId, rows, userId, yearMonth, balance, limit, `月替わり繰越 ${before}→${balance}`);
    } else if (!rows[rowIndex][3]) {
      // 会社名などが空の行は補完しておく
      await _writeBalanceRow(token, sheetId, rows, userId, yearMonth, balance, limit, rows[rowIndex][10] || '会社名などを補完');
    }
    return balance;
  } catch (e) {
    console.error('getUserBalance error:', e.message);
    return limit;
  }
}
async function decrementUserBalance(userId, limit, count) {
  try {
    if (!userId || !count) return;
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const token = await getAccessToken(serviceAccount);
    const yearMonth = new Date().toISOString().slice(0, 7);
    const cap = limit * 2;
    const rows = await _readBalanceRows(token, sheetId);
    const rowIndex = rows.findIndex(r => r[0] === String(userId));
    let balance = limit;
    if (rowIndex >= 0) {
      const lastMonth = rows[rowIndex][1] || yearMonth;
      balance = parseInt(rows[rowIndex][2] || '0');
      const months = _monthDiff(lastMonth, yearMonth);
      if (months > 0) balance = Math.min(balance + limit * months, cap);
    }
    const after = balance - count;
    await _writeBalanceRow(token, sheetId, rows, userId, yearMonth, after, limit, `企業名案内 -${count}社（${balance}→${after}）`);
  } catch (e) {
    console.error('decrementUserBalance error:', e.message);
  }
}
async function setUserBalance(userId, balance) {
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const token = await getAccessToken(serviceAccount);
    const yearMonth = new Date().toISOString().slice(0, 7);
    const rows = await _readBalanceRows(token, sheetId);
    // setUserBalance は会員コース変更時に新しい月間上限で呼ばれる
    await _writeBalanceRow(token, sheetId, rows, userId, yearMonth, balance, balance, `会員コース変更で残高を${balance}に再設定`);
  } catch (e) {
    console.error('setUserBalance error:', e.message);
  }
}

// アプリ2用：マッチング結果を「マッチング結果」シートに保存（管理者レビュー用、ユーザーには非公開）
async function saveMatchResultsForReview(userId, userInfo, matches, aiParams) {
  try {
    if (!matches || matches.length === 0) return;
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const token = await getAccessToken(serviceAccount);
    const now = new Date().toISOString();
    const batchId = `${String(userId || 'guest')}_${now}`;
    const aiParamsJson = JSON.stringify(aiParams || {});
    const memberRank = userInfo.memberRank || 'default';
    // 列: バッチID, 日時, ユーザーID, ユーザー会社名, ユーザー氏名, ユーザーメール, マッチ企業名, スコア, ステータス（未通知/企業名送信済み）, アンケート回答JSON, 名刺データ上の行番号, ユーザー会員ランク
    const values = matches.map(m => [
      batchId, now, String(userId || ''), userInfo.company || '', userInfo.name || '',
      userInfo.email || '', m.company, String(m.score || ''), '未通知', aiParamsJson, String(m.cardRow || ''), memberRank
    ]);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('マッチング結果'+'!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
    );
  } catch (e) {
    console.error('saveMatchResultsForReview error:', e.message);
  }
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadObj = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify(payloadObj))))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const sigInput = `${header}.${payload}`;
  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(sigInput);
  const signature = sign.sign(serviceAccount.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${sigInput}.${signature}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('トークン取得失敗: ' + JSON.stringify(data));
  return data.access_token;
}

// 会員に「企業名送信済み」（岡代表が採択してメールで案内済み）の企業名一覧を、マッチング結果シートから取得する。
// 次回以降のマッチングで、既に紹介した企業を候補から除外するために使う。
async function getIntroducedCompanies(userId) {
  try {
    if (!userId) return [];
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const token = await getAccessToken(serviceAccount);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('マッチング結果')}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json();
    const rows = data.values || [];
    // 列: A=バッチID, C=ユーザーID, G=マッチ企業名, I=ステータス
    return [...new Set(rows.slice(1)
      .filter(r => String(r[2] || '') === String(userId) && r[8] === '企業名送信済み')
      .map(r => r[6])
      .filter(Boolean))];
  } catch (e) {
    console.error('getIntroducedCompanies error:', e.message);
    return [];
  }
}

module.exports = { getIntroducedCompanies, getParticipants, getEmailMap, saveMatchHistory, getMatchHistory, getMonthlyRequestCount, getUserBalance, decrementUserBalance, setUserBalance, saveMatchResultsForReview, MONTHLY_LIMITS };
