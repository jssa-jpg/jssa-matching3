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
  if(event.httpMethod!=='POST')return{statusCode:405,body:'Method Not Allowed'};
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

  try{
    const{userId,company,profile}=JSON.parse(event.body);
    if(!userId&&!company)return{statusCode:400,headers,body:JSON.stringify({error:'ユーザー情報が必要です'})};

    const token=await getAccessToken();
    const sheetId=process.env.GOOGLE_SHEET_ID;

    // ユーザー登録シートからユーザーを検索
    const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('ユーザー登録')}`,{headers:{'Authorization':`Bearer ${token}`}});
    const data=await res.json();
    const rows=data.values||[];

    // userIdまたはcompanyで検索
    const rowIndex=rows.findIndex((r,i)=>i>0&&(r[0]===userId||r[1]===company));

    if(rowIndex<0){
      // ユーザーが見つからない場合はスキップして成功を返す
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'プロフィールをスキップしました'})};
    }

    const row=rowIndex+1;
    // K列以降にプロフィール情報を追加
    const profileValues=[[
      profile.fundingRound||'',
      profile.fundingTarget||'',
      profile.challenges||'',
      profile.globalExpansion||'',
    
      profile.supportCount||'',
      profile.supportArea||'',
      profile.investmentIndustry||'',
      profile.targetRound||''
    ]];

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`ユーザー登録!L${row}:S${row}`)}?valueInputOption=RAW`,{
      method:'PUT',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({values:profileValues})
    });

    return{statusCode:200,headers,body:JSON.stringify({success:true,message:'プロフィールを保存しました'})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
