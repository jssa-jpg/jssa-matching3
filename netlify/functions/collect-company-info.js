// 名刺データの企業情報（O〜W列）をAIで補完する管理者用の関数
//  action:'findEmpty' … 会社名があり、O列（業種）が空の行番号を返す
//  action:'enrich'    … 指定行の会社をAIで調べてO〜W列に書き込む（Web検索あり。時間切れ時は知識ベースで再実行）
const ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY;
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;
const SHEET='名刺データ';
const INDUSTRIES=['VC・CVC・エンジェル・投資事業','M&A仲介会社・FA','コンサルタント・士業・監査法人','金融・保険・証券代行','教育・研究機関・学校法人','官公庁・自治体・各種団体等','ITサービス・AI・通信・Web3','人材・HR系サービス','製造業・食品・環境・エネルギー・バイオ・宇宙・農林水産','観光・エンタメ・スポーツ・アート','医療・ヘルスケア・福祉・保育・シニア','商社・流通・小売・EC','建設・不動産','広告・メディア・出版'];

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
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${sig_input}.${sig}`});
  const data=await res.json();
  if(!data.access_token)throw new Error('トークン取得失敗');
  return data.access_token;
}

function buildPrompt(r){
  return `次の会社について調べ、名刺データベース用の企業情報をJSONで回答してください。
確信の持てない項目は推測で埋めず、空文字にしてください（特に従業員数・資本金・設立年・採用人数・M&A実績）。

会社名: ${r.company}
会社URL: ${r.url||'不明'}
名刺の部署・役職: ${[r.dept,r.position].filter(Boolean).join(' ')||'不明'}
住所: ${r.address||'不明'}

回答形式（JSONのみ。前置きや説明は不要）:
{"industry":"次のいずれか1つを完全一致で: ${INDUSTRIES.join(' / ')}",
"scale":"EP（従業員500名以上）/ MID（50〜499名）/ SMB（49名以下）のいずれか",
"employees":"従業員数（数字のみ）",
"founded":"設立年（例：2010年）",
"capital":"資本金（例：1,000万円）",
"listed":"上場市場名（例：東証グロース。未上場は空文字）",
"hiring":"年間採用人数（例：5名）",
"ma":"M&A実績（例：2件、実績なし）",
"features":"事業内容と特徴を100文字程度で"}`;
}

async function askClaude(prompt,useWeb,timeoutMs){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const body={model:'claude-sonnet-4-6',max_tokens:1200,messages:[{role:'user',content:prompt}]};
    if(useWeb)body.tools=[{type:'web_search_20250305',name:'web_search',max_uses:2}];
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:ctrl.signal,
      headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},
      body:JSON.stringify(body)});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error?.message||`API ${res.status}`);
    const text=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
    const m=text.replace(/```json|```/g,'').match(/\{[\s\S]*\}/);
    if(!m)throw new Error('JSONが見つかりません');
    return JSON.parse(m[0]);
  }finally{clearTimeout(timer);}
}

function normalize(info){
  const industry=INDUSTRIES.includes(info.industry)?info.industry:(INDUSTRIES.find(x=>info.industry&&(x.includes(info.industry)||info.industry.includes(x.split('・')[0])))||'');
  const scale=['EP','MID','SMB'].includes(String(info.scale||'').trim().toUpperCase())?String(info.scale).trim().toUpperCase():'';
  const s=v=>String(v==null?'':v).trim();
  return{industry,scale,employees:s(info.employees).replace(/[^\d]/g,''),founded:s(info.founded),capital:s(info.capital),listed:s(info.listed),hiring:s(info.hiring),ma:s(info.ma),features:s(info.features).slice(0,150)};
}

exports.handler=async(event)=>{
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if(event.httpMethod==='OPTIONS'){return{statusCode:200,headers:{...headers,'Access-Control-Allow-Headers':'Content-Type,Authorization,x-admin-password'},body:''};}
  const pw=event.headers['x-admin-password']||(event.headers.authorization||'').replace('Bearer ','');
  if(!ADMIN_PASSWORD||pw!==ADMIN_PASSWORD){return{statusCode:401,headers,body:JSON.stringify({error:'認証失敗'})};}

  try{
    const body=JSON.parse(event.body||'{}');
    const action=body.action||'enrich';
    const sheetId=process.env.GOOGLE_SHEET_ID;
    const token=await getAccessToken();

    if(action==='findEmpty'){
      const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET+'!A2:O')}`,{headers:{'Authorization':`Bearer ${token}`}});
      const data=await res.json();
      const rows=data.values||[];
      const targets=[];
      const from=parseInt(body.fromRow,10)||2,to=parseInt(body.toRow,10)||Infinity;
      rows.forEach((r,i)=>{const n=i+2;if(n<from||n>to)return;if(String(r[0]||'').trim()&&!String(r[14]||'').trim())targets.push({row:n,company:String(r[0]).trim()});});
      return{statusCode:200,headers,body:JSON.stringify({success:true,lastRow:rows.length+1,targets})};
    }

    const row=parseInt(body.row,10);
    if(!row||row<2)return{statusCode:400,headers,body:JSON.stringify({error:'行番号が不正です'})};
    const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${SHEET}!A${row}:O${row}`)}`,{headers:{'Authorization':`Bearer ${token}`}});
    const data=await res.json();
    const r=data.values?.[0]||[];
    const rec={company:String(r[0]||'').trim(),dept:r[1]||'',position:r[2]||'',address:r[6]||'',url:r[12]||''};
    if(!rec.company)return{statusCode:200,headers,body:JSON.stringify({success:false,row,message:'会社名が空です'})};
    if(String(r[14]||'').trim()&&!body.overwrite)return{statusCode:200,headers,body:JSON.stringify({success:false,row,company:rec.company,message:'補完済みのためスキップ'})};

    const prompt=buildPrompt(rec);
    let info=null,mode='web';
    if(body.useWeb!==false){
      try{info=await askClaude(prompt,true,15000);}catch(e){console.log(`Web検索で失敗（${rec.company}）:`,e.message);}
    }
    if(!info){mode='knowledge';info=await askClaude(prompt,false,7000);}
    const v=normalize(info);

    const values=[[v.industry,v.scale,v.employees,v.founded,v.capital,v.listed,v.hiring,v.ma,v.features]];
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${SHEET}!O${row}:W${row}`)}?valueInputOption=RAW`,{
      method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values})
    });
    return{statusCode:200,headers,body:JSON.stringify({success:true,row,company:rec.company,mode,info:v})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
