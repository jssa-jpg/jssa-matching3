const { getParticipants } = require('./sheets-helper');

// トップページの「◯人のビッグデータから分析」表示用。合計人数のみを返す（パスワード不要・機密情報は含まない）
exports.handler = async () => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const participants = await getParticipants();
    return { statusCode: 200, headers, body: JSON.stringify({ total: participants.length }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
