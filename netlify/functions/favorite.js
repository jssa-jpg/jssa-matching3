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
  if(event.httpMethod!=='POST')return{statusCode:405,headers:{'Access-Control-Allow-Origin':'*'},body:'Method Not Allowed'};
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  try{
    const body=JSON.parse(event.body||'{}');
    const{action,userId,company,position}=body;
    if(!userId)return{statusCode:400,headers,body:JSON.stringify({error:'ユーザーIDが必要です'})};
    const token=await getAccessToken();
    const sheetId=process.env.GOOGLE_SHEET_ID;
    const getRes=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('お気に入り')}`,{headers:{'Authorization':`Bearer ${token}`}});
    const getData=await getRes.json();
    const rows=getData.values||[];

    if(action==='list'){
      const favorites=rows.slice(1).filter(r=>r[0]===userId).map(r=>({company:r[1]||'',position:r[2]||'',createdAt:r[3]||''}));
      return{statusCode:200,headers,body:JSON.stringify({success:true,favorites})};
    }

    if(action==='add'){
      if(!company)return{statusCode:400,headers,body:JSON.stringify({error:'会社名が必要です'})};
      const exists=rows.slice(1).some(r=>r[0]===userId&&r[1]===company);
      if(exists)return{statusCode:200,headers,body:JSON.stringify({success:true,message:'既に登録済みです'})};
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('お気に入り')}:append?valueInputOption=RAW`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[userId,company,position||'',new Date().toISOString()]]})});
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'お気に入りに追加しました'})};
    }

    if(action==='remove'){
      if(!company)return{statusCode:400,headers,body:JSON.stringify({error:'会社名が必要です'})};
      const rowIndex=rows.findIndex((r,i)=>i>0&&r[0]===userId&&r[1]===company);
      if(rowIndex<0)return{statusCode:200,headers,body:JSON.stringify({success:true,message:'登録されていません'})};
      const sheetRes=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,{headers:{'Authorization':`Bearer ${token}`}});
      const sheetData=await sheetRes.json();
      const sheet=sheetData.sheets.find(s=>s.properties.title==='お気に入り');
      if(sheet){
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requests:[{deleteDimension:{range:{sheetId:sheet.properties.sheetId,dimension:'ROWS',startIndex:rowIndex,endIndex:rowIndex+1}}}]})});
      }
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'お気に入りから削除しました'})};
    }

    return{statusCode:400,headers,body:JSON.stringify({error:'不明なアクションです'})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
