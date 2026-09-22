const{getMonthlyRequestCount}=require('./sheets-helper');
const MONTHLY_LIMITS={'レギュラーライト':1,'レギュラー':2,'プライム':5,'ライト':1,'特待生':2,'default':3};

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

async function incrementMonthlyCount(userId,token){
  const sheetId=process.env.GOOGLE_SHEET_ID;
  const yearMonth=new Date().toISOString().slice(0,7);
  const getRes=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/月次リクエスト数`,{headers:{'Authorization':`Bearer ${token}`}});
  const getData=await getRes.json();
  const rows=getData.values||[];
  const rowIndex=rows.findIndex(r=>r[0]===String(userId)&&r[1]===yearMonth);
  if(rowIndex>=0){
    const currentCount=parseInt(rows[rowIndex][2]||"0");
    const range=`月次リクエスト数!C${rowIndex+1}`;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[String(currentCount+1)]]})});
  }else{
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/月次リクエスト数:append?valueInputOption=RAW`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[String(userId),yearMonth,"1"]]})});
  }
}

async function saveRequest(userId,userInfo,targetCompany,targetPosition,firstMessage,matchReason,recommendation,token){
  const sheetId=process.env.GOOGLE_SHEET_ID;
  const requestId=`REQ-${Date.now()}`;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/会いたいリクエスト:append?valueInputOption=RAW`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[requestId,String(userId),targetCompany||'',targetPosition||'','リクエスト受付',new Date().toISOString(),'',userInfo.company||'',userInfo.name||'',userInfo.email||'',firstMessage||'',matchReason||'',recommendation||'']]})});
}

const rateLimit=new Map();
function checkRateLimit(ip){
  const now=Date.now();
  const entry=rateLimit.get(ip)||{count:0,reset:now+60000};
  if(now>entry.reset){entry.count=0;entry.reset=now+60000;}
  entry.count++;
  rateLimit.set(ip,entry);
  return entry.count<=10;
}

exports.handler=async(event)=>{
  if(event.httpMethod==="OPTIONS")return{statusCode:200,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type"},body:""};
  if(event.httpMethod!=="POST")return{statusCode:405,body:"Method Not Allowed"};
  const headers={"Access-Control-Allow-Origin":"*","Content-Type":"application/json"};
  const ip=event.headers["x-forwarded-for"]?.split(",")[0]||"unknown";
  if(!checkRateLimit(ip))return{statusCode:429,headers,body:JSON.stringify({error:"リクエストが多すぎます。"})};

  try{
    const{userInfo,targetCompany,targetPosition,matchReason,recommendation,firstMessage}=JSON.parse(event.body);
    if(!userInfo||!targetCompany)return{statusCode:400,headers,body:JSON.stringify({error:"必須項目が不足しています"})};

    const memberRank=userInfo.memberRank||'default';
    const MONTHLY_LIMIT=MONTHLY_LIMITS[memberRank]||MONTHLY_LIMITS['default'];
    const userId=userInfo.id||userInfo.company;
    const currentCount=await getMonthlyRequestCount(userId);
    if(currentCount>=MONTHLY_LIMIT){
      return{statusCode:403,headers,body:JSON.stringify({error:`今月のリクエスト上限（${MONTHLY_LIMIT}名）に達しました。翌月1日にリセットされます。`,remaining:0,limit:MONTHLY_LIMIT})};
    }

    const token=await getAccessToken();
    await incrementMonthlyCount(userId,token);
    await saveRequest(userId,userInfo,targetCompany,targetPosition,firstMessage,matchReason,recommendation,token);

    const RESEND_API_KEY=process.env.RESEND_API_KEY;
    const TO_EMAIL='tok@yumeplanning.jp';

    if(RESEND_API_KEY){
      const htmlBody=`<div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <div style="background:#0B0F1A;padding:18px 24px;"><span style="background:#639922;color:#fff;font-weight:800;font-size:12px;padding:3px 10px;border-radius:4px;">JSSA</span><span style="color:#fff;font-size:14px;margin-left:10px;">会いたいリクエスト通知</span></div>
        <div style="padding:24px;">
          <p style="margin-bottom:16px;">岡様<br><br>以下の「会いたい」リクエストが届きました。</p>
          <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px;">
            <tr><td style="padding:8px;font-weight:700;color:#6B7280;width:120px;">リクエスト会員</td><td style="padding:8px;">${userInfo.company||''} ${userInfo.name||''}</td></tr>
            <tr><td style="padding:8px;font-weight:700;color:#6B7280;">会員ランク</td><td style="padding:8px;">${memberRank}</td></tr>
            <tr><td style="padding:8px;font-weight:700;color:#6B7280;">希望相手企業</td><td style="padding:8px;font-weight:700;">${targetCompany}</td></tr>
            <tr><td style="padding:8px;font-weight:700;color:#6B7280;">役職</td><td style="padding:8px;">${targetPosition||'—'}</td></tr>
          </table>
          ${matchReason?`<div style="background:#F0F9E8;border-left:4px solid #639922;padding:12px;margin-bottom:10px;"><p style="font-size:12px;font-weight:700;color:#27500A;margin:0 0 4px;">AIマッチ理由</p><p style="font-size:13px;margin:0;">${matchReason}</p></div>`:''}
          ${firstMessage?`<div style="background:#FFF8E1;border-left:4px solid #F9A825;padding:12px;margin-bottom:16px;"><p style="font-size:12px;font-weight:700;color:#7B5800;margin:0 0 4px;">メッセージ</p><p style="font-size:13px;margin:0;">${firstMessage}</p></div>`:''}
          <div style="text-align:center;"><a href="https://jssa-matching2.jp/admin" style="background:#0B0F1A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">管理画面で確認 →</a></div>
        </div>
      </div>`;
      const resendRes=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:"onboarding@resend.dev",to:[TO_EMAIL],subject:`【会いたいリクエスト】${userInfo.company||''}${userInfo.name||''} → ${targetCompany}`,html:htmlBody})});
      const resendData=await resendRes.json();
      console.log('Resend結果:',JSON.stringify(resendData));
    }

    const remaining=MONTHLY_LIMIT-currentCount-1;
    return{statusCode:200,headers,body:JSON.stringify({success:true,message:"リクエストを送信しました。岡代表に通知しました。",remaining,limit:MONTHLY_LIMIT})};

  }catch(e){
    console.error('エラー:',e.message);
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
