const { getParticipants } = require('./sheets-helper');

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const pass = (event.queryStringParameters || {}).pass || "";
    if (pass !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "認証が必要です" }) };
    }
    const participants = await getParticipants();
    const first = participants[0] || {};
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        total: participants.length,
        keys: Object.keys(first),
        sample: first
      })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message, stack: e.stack }) };
  }
};
