const ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY;
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;

async function getAccessToken(){
  const sa=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const crypto=require('crypto');
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const pay=Buffer.from(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})).toString('base64url');
  const sig_input=`${header}.${pay}`;
  const sign=crypto.createSign('RSA-SHA256');
  sign.update(sig_input);
  const sig=sign.sign(sa.private_key,'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt=`${sig_input}.${sig}`;
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`});
  const data=await res.json();
  if(!data.access_token)throw new Error('トークン取得失敗');
  return data.access_token;
}

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS'){return{statusCode:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization'},body:''};}
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  const auth=event.headers.authorization||'';
  if(auth.replace('Bearer ','')!==ADMIN_PASSWORD){return{statusCode:401,headers,body:JSON.stringify({error:'認証失敗'})};}

  try{
    const{row=2}=JSON.parse(event.body||'{}');
    const sheetId=process.env.GOOGLE_SHEET_ID;
    const token=await getAccessToken();

    // 指定行のデータ取得
    const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A${row}:N${row}`,{headers:{'Authorization':`Bearer ${token}`}});
    const data=await res.json();
    const rowData=data.values?.[0]||[];
    const company=rowData[0]||'';
    const siteUrl=rowData[12]||'';

    if(!company){return{statusCode:200,headers,body:JSON.stringify({success:false,message:'会社名なし'})};}

    // Claude APIで企業情報収集（web_searchなし・知識ベースで回答）
    const prompt=`以下の会社について知っている情報をJSONで回答してください。不明な項目は空文字にしてください。

会社名: ${company}
会社URL: ${siteUrl||'不明'}

{"industry":"業種（例：ITサービス・AI・通信・Web3）","scale":"EP=500名以上 MID=50〜500名 SMB=50名以下","employees":"従業員数（数字のみ）","founded":"設立年（例：2010年）","capital":"資本金（例：1000万円）","listed":"上場市場名（未上場は空）","hiring":"年間採用人数（例：5名）","ma":"M&A実績（例：2件、実績なし）","features":"企業特徴100文字以内"}

JSONのみ回答してください。`;

    const aiRes=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:300,messages:[{role:'user',content:prompt}]})
    });
    const aiData=await aiRes.json();
    const text=aiData.content?.[0]?.text||'{}';
    const clean=text.replace(/```json|```/g,'').trim();
    let info;
    try{info=JSON.parse(clean);}catch(e){return{statusCode:200,headers,body:JSON.stringify({success:false,message:'JSON解析失敗',text})};}

    // O列〜W列に書き込み
    const range=`O${row}:W${row}`;
    const values=[[info.industry||'',info.scale||'',info.employees||'',info.founded||'',info.capital||'',info.listed||'',info.hiring||'',info.ma||'',info.features||'']];
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,{
      method:'PUT',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({values})
    });

    return{statusCode:200,headers,body:JSON.stringify({success:true,row,company,info})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
