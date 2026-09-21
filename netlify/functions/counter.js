async function getAccessToken(){
  const sa=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const crypto=require('crypto');
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).toString('base64url');
  const si=`${h}.${p}`;
  const sign=crypto.createSign('RSA-SHA256');
  sign.update(si);
  const sig=sign.sign(sa.private_key,'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt=`${si}.${sig}`;
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`});
  const data=await res.json();
  if(!data.access_token)throw new Error('トークン取得失敗');
  return data.access_token;
}

const rateLimit=new Map();
function checkRateLimit(ip){
  const now=Date.now();
  const entry=rateLimit.get(ip)||{count:0,reset:now+60000};
  if(now>entry.reset){entry.count=0;entry.reset=now+60000;}
  entry.count++;
  rateLimit.set(ip,entry);
  return entry.count<=60;
}

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'},body:''};
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  try{
    const token=await getAccessToken();
    const sheetId=process.env.GOOGLE_SHEET_ID;
    const range='カウンター!A1';
    // 現在のカウントを取得
    const getRes=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,{headers:{'Authorization':`Bearer ${token}`}});
    const getData=await getRes.json();
    let count=parseInt((getData.values||[[0]])[0][0])||0;
    // POSTの場合はカウントアップ
    if(event.httpMethod==='POST'){
      const ip=event.headers['x-forwarded-for']?.split(',')[0]||'unknown';
      if(checkRateLimit(ip)){
        count++;
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[String(count)]]})});
      }
    }
    return{statusCode:200,headers,body:JSON.stringify({count})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({count:0,error:e.message})};
  }
};
