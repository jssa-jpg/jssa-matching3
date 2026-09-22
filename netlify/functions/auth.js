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

async function getSheet(token,name){
  const id=process.env.GOOGLE_SHEET_ID;
  const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(name)}`,{headers:{'Authorization':`Bearer ${token}`}});
  const data=await res.json();
  return data.values||[];
}

async function appendRow(token,name,values){
  const id=process.env.GOOGLE_SHEET_ID;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(name)}:append?valueInputOption=RAW`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[values]})});
}

async function updateRow(token,name,row,values){
  const id=process.env.GOOGLE_SHEET_ID;
  const range=`${name}!A${row}:L${row}`;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[values]})});
}

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'},body:''};
  if(event.httpMethod!=='POST')return{statusCode:405,body:'Method Not Allowed'};
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

  try{
    const{action,inviteCode,company,position,name,email,mobile,website,facebook}=JSON.parse(event.body);

    const token=await getAccessToken();

    // 招待コード確認
    const inviteRows=await getSheet(token,'招待コード');
    const inviteIndex=inviteRows.findIndex((r,i)=>i>0&&r[0]===inviteCode&&r[4]==='有効');
    if(inviteIndex<0){
      return{statusCode:401,headers,body:JSON.stringify({error:'招待コードが無効です。事務局にお問い合わせください。'})};
    }
    const memberRank=inviteRows[inviteIndex][6]||'レギュラー';

    const userRows=await getSheet(token,'ユーザー登録');
    const existingIndex=userRows.findIndex((r,i)=>i>0&&r[4]===email);

    if(action==='login'){
      if(existingIndex<0){
        return{statusCode:404,headers,body:JSON.stringify({error:'登録されていません。新規登録してください。',needRegister:true})};
      }
      const r=userRows[existingIndex];
      await updateRow(token,'ユーザー登録',existingIndex+1,[r[0],r[1],r[2],r[3],r[4],r[5],r[6]||'',r[7]||'',r[8],new Date().toISOString(),'1']);
      return{statusCode:200,headers,body:JSON.stringify({
        success:true,
        user:{
          id:r[0],company:r[1],position:r[2],name:r[3],email:r[4],
          mobile:r[5],website:r[6]||'',facebook:r[7]||'',
          memberRank,
          profile:{
            fundingRound:r[11]||'',fundingTarget:r[12]||'',challenges:r[13]||'',
            globalExpansion:r[14]||'',kpi:r[15]||'',supportCount:r[16]||'',
            supportArea:r[17]||'',investmentIndustry:r[18]||'',targetRound:r[19]||''
          }
        }
      })};
    }

    if(action==='register'){
      if(!company||!position||!name||!email||!mobile){
        return{statusCode:400,headers,body:JSON.stringify({error:'必須項目を全て入力してください'})};
      }
      if(existingIndex>=0){
        return{statusCode:409,headers,body:JSON.stringify({error:'このメールアドレスは既に登録されています。ログインしてください。',needLogin:true})};
      }
      const userId='U'+Date.now();
      const now=new Date().toISOString();
      // L〜S列はプロフィール情報用に予約されているため空欄で確保し、T列に請求書管理番号（招待コード）を記録する
      await appendRow(token,'ユーザー登録',[userId,company,position,name,email,mobile,website||'',facebook||'',now,now,'1','','','','','','','','',inviteCode]);

      // 招待コードを使用済みに更新
      const id=process.env.GOOGLE_SHEET_ID;
      const updateToken=token;
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`招待コード!C${inviteIndex+1}`)}?valueInputOption=RAW`,{method:'PUT',headers:{'Authorization':`Bearer ${updateToken}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[email]]})});
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`招待コード!D${inviteIndex+1}`)}?valueInputOption=RAW`,{method:'PUT',headers:{'Authorization':`Bearer ${updateToken}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[now]]})});
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`招待コード!E${inviteIndex+1}`)}?valueInputOption=RAW`,{method:'PUT',headers:{'Authorization':`Bearer ${updateToken}`,'Content-Type':'application/json'},body:JSON.stringify({values:[['使用済']]})});

      return{statusCode:200,headers,body:JSON.stringify({
        success:true,
        user:{
          id:userId,company,position,name,email,mobile,
          website:website||'',facebook:facebook||'',
          memberRank,
          profile:{fundingRound:'',fundingTarget:'',challenges:'',globalExpansion:'',kpi:'',supportCount:'',supportArea:'',investmentIndustry:'',targetRound:''}
        }
      })};
    }

    return{statusCode:400,headers,body:JSON.stringify({error:'不明なアクションです'})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
