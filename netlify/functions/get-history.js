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

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'},body:''};
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  try{
    const{userId}=JSON.parse(event.body||'{}');
    if(!userId)return{statusCode:400,headers,body:JSON.stringify({error:'ユーザーIDが必要です'})};
    const token=await getAccessToken();
    const sheetId=process.env.GOOGLE_SHEET_ID;
    const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('会いたいリクエスト')}`,{headers:{'Authorization':`Bearer ${token}`}});
    const data=await res.json();
    const rows=data.values||[];
    const history=rows.slice(1)
      .filter(r=>r[1]===userId)
      .map(r=>({
        requestId:r[0]||'',
        targetCompany:r[2]||'',
        targetPosition:r[3]||'',
        status:r[4]||'リクエスト受付',
        createdAt:r[5]||'',
        message:r[10]||''
      }))
      .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    return{statusCode:200,headers,body:JSON.stringify({success:true,history})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
