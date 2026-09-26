// 名刺データの企業情報（O〜W列）をAIで補完する管理者用の関数
//  action:'findEmpty' … 会社名があり、O列（業種）が空の行番号を返す
//  action:'findDuplicates' … 同じ人物の名刺が複数ある組を返す（最新1枚を残し、古い名刺を削除する候補）
//  action:'mergeDuplicates' … 古い名刺の企業情報を最新の名刺へ引き継いだうえで、古い名刺の行を削除する
//  action:'enrich'    … 指定行の会社をAIで調べてO〜W列に書き込む（Web検索あり。時間切れ時は知識ベースで再実行）
const{personKey,isNewerCard}=require('./sheets-helper');
const RULES=require('./survey-rules');
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
確信の持てない項目は推測で埋めず、空文字にしてください（特に従業員数・資本金・設立年・採用人数・M&A実績・URL・住所）。
URLと住所は、名刺の会社と同じ会社であることを確認できたものだけを回答してください。

会社名: ${r.company}
会社URL: ${r.url||'不明'}
名刺の部署・役職: ${[r.dept,r.position].filter(Boolean).join(' ')||'不明'}
メールアドレスのドメイン: ${(String(r.email||'').split('@')[1])||'不明'}
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
"features":"事業内容と特徴を100文字程度で",
"url":"公式サイトのURL（https://から。実在を確認できたものだけ）",
"postal":"本社の郵便番号（例：530-0001）",
"address":"本社所在地（都道府県から番地まで）"}`;
}

async function askClaude(prompt,useWeb,timeoutMs){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const body={model:'claude-sonnet-4-6',max_tokens:1200,messages:[{role:'user',content:prompt}]};
    if(useWeb)body.tools=[{type:'web_search_20250305',name:'web_search',max_uses:3}];
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
  const url=/^https?:\/\/[^\s]+\.[^\s]+/.test(s(info.url))?s(info.url):'';
  const postal=(s(info.postal).match(/\d{3}-?\d{4}/)||[''])[0].replace(/^(\d{3})(\d{4})$/,'$1-$2');
  return{industry,scale,employees:s(info.employees).replace(/[^\d]/g,''),founded:s(info.founded),capital:s(info.capital),listed:s(info.listed),hiring:s(info.hiring),ma:s(info.ma),features:s(info.features).slice(0,150),url,postal,address:s(info.address)};
}

// 同じ人物の名刺の組を作る（最新＝keep、古い名刺＝remove）
async function buildDuplicateGroups(token,sheetId){
  const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET+'!A2:AI')}`,{headers:{'Authorization':`Bearer ${token}`}});
  const data=await res.json();
  const rows=data.values||[];
  const map=new Map();
  rows.forEach((r,i)=>{
    const card={row:i+2,cardRow:i+2,company:String(r[0]||'').trim(),department:r[1]||'',position:r[2]||'',name:r[3]||'',email:r[4]||'',cardDate:r[13]||'',values:r};
    if(!card.company)return;
    const k=personKey(card.company,card.name,card.email);
    if(!k)return;
    if(!map.has(k))map.set(k,[]);
    map.get(k).push(card);
  });
  const groups=[];
  for(const cards of map.values()){
    if(cards.length<2)continue;
    let keep=cards[0];
    for(const c of cards)if(isNewerCard(c,keep))keep=c;
    groups.push({keep,remove:cards.filter(c=>c!==keep)});
  }
  return groups;
}
const brief=c=>({row:c.row,company:c.company,department:c.department,position:c.position,name:c.name,email:c.email,cardDate:c.cardDate});

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

    if(action==='findDuplicates'){
      const groups=await buildDuplicateGroups(token,sheetId);
      return{statusCode:200,headers,body:JSON.stringify({success:true,groups:groups.map(g=>({keep:brief(g.keep),remove:g.remove.map(brief)}))})};
    }

    if(action==='mergeDuplicates'){
      const groups=await buildDuplicateGroups(token,sheetId);
      if(groups.length===0)return{statusCode:200,headers,body:JSON.stringify({success:true,merged:0,deleted:0})};
      // 1) 最新の名刺で空になっている企業情報（URL＝M列、業種〜企業特徴＝O〜W列）を古い名刺から引き継ぐ
      //    ※部署・役職・電話・住所など個人や拠点の情報は、古い内容を引き継がない
      const data2=[];
      const col=n=>String.fromCharCode(65+n);
      for(const g of groups){
        const kv=g.keep.values;
        const olds=[...g.remove].sort((a,b)=>isNewerCard(a,b)?-1:1);
        for(const idx of [12,14,15,16,17,18,19,20,21,22]){
          if(String(kv[idx]||'').trim())continue;
          const src=olds.find(o=>String(o.values[idx]||'').trim());
          if(src)data2.push({range:`${SHEET}!${col(idx)}${g.keep.row}`,values:[[src.values[idx]]]});
        }
      }
      if(data2.length){
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data:data2})});
      }
      // 2) 古い名刺の行を下から順に削除（行番号のずれを防ぐ）
      const meta=await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,{headers:{'Authorization':`Bearer ${token}`}})).json();
      const gid=(meta.sheets||[]).map(x=>x.properties).find(p=>p.title===SHEET)?.sheetId;
      if(gid===undefined)return{statusCode:500,headers,body:JSON.stringify({error:'名刺データシートが見つかりません'})};
      const delRows=groups.flatMap(g=>g.remove.map(c=>c.row)).sort((a,b)=>b-a);
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({requests:delRows.map(r=>({deleteDimension:{range:{sheetId:gid,dimension:'ROWS',startIndex:r-1,endIndex:r}}}))})});
      return{statusCode:200,headers,body:JSON.stringify({success:true,merged:groups.length,deleted:delRows.length,copied:data2.length})};
    }

    if(action==='findUnclassified'){
      // 属性（AJ列）が空の会社を一覧にする（会社単位）
      const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET+'!A2:AK')}`,{headers:{'Authorization':`Bearer ${token}`}});
      const data=await res.json();
      const seen=new Map();
      (data.values||[]).forEach(r=>{const c=String(r[0]||'').trim();if(!c)return;const k=c.normalize('NFKC').replace(/\s/g,'');if(!seen.has(k))seen.set(k,{company:c,done:!!String(r[35]||'').trim()});else if(String(r[35]||'').trim())seen.get(k).done=true;});
      const all=[...seen.values()];
      return{statusCode:200,headers,body:JSON.stringify({success:true,totalCompanies:all.length,targets:all.filter(x=>!x.done).map(x=>x.company)})};
    }

    if(action==='classify'){
      // 会社を新アンケートの「属性」と「業種詳細（最大2つ）」に分類し、その会社の全行のAJ・AK列に書き込む
      const names=(Array.isArray(body.companies)?body.companies:[]).slice(0,20);
      if(!names.length)return{statusCode:400,headers,body:JSON.stringify({error:'会社がありません'})};
      const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET+'!A1:AK')}`,{headers:{'Authorization':`Bearer ${token}`}});
      const rows=(await res.json()).values||[];
      const nk=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
      const want=new Set(names.map(nk));
      const info=new Map();
      rows.forEach((r,i)=>{if(i===0)return;const k=nk(r[0]);if(!want.has(k))return;if(!info.has(k))info.set(k,{company:String(r[0]).trim(),rows:[],depts:new Set(),old:r[14]||'',scale:r[15]||'',listed:r[19]||'',features:r[22]||'',url:r[12]||''});const x=info.get(k);x.rows.push(i+1);if(r[1])x.depts.add(String(r[1]).trim());if(!x.features&&r[22])x.features=r[22];});
      const list=[...info.values()];
      const prompt=`次の会社を、スタートアップ支援のマッチング用に分類してください。
各社について「attribute」を下の属性から1つ、「industries」を下の業種・領域から1〜2つ選びます（主な事業の順）。
VC・CVC・銀行・コンサル・士業などの支援側の会社は、industries に「投資・支援の注力領域」を選び、わからなければ自社の業種（金融・FinTech、経営コンサルティング、法務・会計・税務など）を選んでください。
上場している大手や、スタートアップでない一般企業は「大企業・事業会社」にします。

【属性】${RULES.ATTRIBUTES.join(' / ')}
【業種・領域】${RULES.INDUSTRIES.join(' / ')}

【会社一覧】
${list.map((c,i)=>`${i+1}. ${c.company}｜旧業種:${c.old||'-'}｜規模:${c.scale||'-'}｜上場:${c.listed||'-'}｜部署例:${[...c.depts].slice(0,3).join('、')||'-'}｜URL:${c.url||'-'}｜概要:${String(c.features).slice(0,120)||'-'}`).join('\n')}

回答はJSON配列のみ（説明不要）。会社の順番・件数は一覧と同じにしてください。
[{"no":1,"attribute":"...","industries":["...","..."]}]`;
      const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),22000);
      let arr=[];
      try{
        const ai=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:ctrl.signal,headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:2500,messages:[{role:'user',content:prompt}]})});
        const d=await ai.json();
        const text=(d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
        const m=text.replace(/```json|```/g,'').match(/\[[\s\S]*\]/);
        arr=m?JSON.parse(m[0]):[];
      }finally{clearTimeout(timer);}
      // AJ・AK列の見出しと列数を用意する
      const meta=await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,{headers:{'Authorization':`Bearer ${token}`}})).json();
      const prop=(meta.sheets||[]).map(x=>x.properties).find(p=>p.title===SHEET);
      if(prop&&prop.gridProperties&&prop.gridProperties.columnCount<37){
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requests:[{appendDimension:{sheetId:prop.sheetId,dimension:'COLUMNS',length:37-prop.gridProperties.columnCount}}]})});
      }
      const data2=[];
      if(!rows[0]||rows[0][35]!=='属性')data2.push({range:`${SHEET}!AJ1:AK1`,values:[['属性','業種詳細']]});
      const out=[];
      list.forEach((c,i)=>{
        const a=arr.find(x=>Number(x.no)===i+1)||arr[i]||{};
        const attr=RULES.ATTRIBUTES.includes(a.attribute)?a.attribute:'';
        const inds=(Array.isArray(a.industries)?a.industries:[]).filter(x=>RULES.INDUSTRIES.includes(x)).slice(0,2);
        const attrVal=attr||'（分類不可）';
        c.rows.forEach(r=>data2.push({range:`${SHEET}!AJ${r}:AK${r}`,values:[[attrVal,inds.join('／')]]}));
        out.push({company:c.company,attribute:attrVal,industries:inds,rows:c.rows.length});
      });
      if(data2.length)await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data:data2})});
      return{statusCode:200,headers,body:JSON.stringify({success:true,results:out})};
    }

    const row=parseInt(body.row,10);
    if(!row||row<2)return{statusCode:400,headers,body:JSON.stringify({error:'行番号が不正です'})};
    const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${SHEET}!A${row}:O${row}`)}`,{headers:{'Authorization':`Bearer ${token}`}});
    const data=await res.json();
    const r=data.values?.[0]||[];
    const rec={company:String(r[0]||'').trim(),dept:r[1]||'',position:r[2]||'',address:r[6]||'',url:r[12]||'',email:r[4]||''};
    if(!rec.company)return{statusCode:200,headers,body:JSON.stringify({success:false,row,message:'会社名が空です'})};
    if(String(r[14]||'').trim()&&!body.overwrite)return{statusCode:200,headers,body:JSON.stringify({success:false,row,company:rec.company,message:'補完済みのためスキップ'})};

    const prompt=buildPrompt(rec);
    let info=null,mode='web';
    if(body.useWeb!==false){
      try{info=await askClaude(prompt,true,15000);}catch(e){console.log(`Web検索で失敗（${rec.company}）:`,e.message);}
    }
    if(!info){mode='knowledge';info=await askClaude(prompt,false,7000);}
    const v=normalize(info);

    // O〜W列（業種〜企業特徴）と、名刺に無かった場合だけ F列（郵便番号）・G列（住所）・M列（URL）を書き込む
    const data2=[{range:`${SHEET}!O${row}:W${row}`,values:[[v.industry,v.scale,v.employees,v.founded,v.capital,v.listed,v.hiring,v.ma,v.features]]}];
    const filled=[];
    if(!String(r[6]||'').trim()&&v.address){
      data2.push({range:`${SHEET}!G${row}`,values:[[v.address]]});filled.push('住所');
      if(!String(r[5]||'').trim()&&v.postal)data2.push({range:`${SHEET}!F${row}`,values:[[v.postal]]});
    }
    if(!String(r[12]||'').trim()&&v.url){data2.push({range:`${SHEET}!M${row}`,values:[[v.url]]});filled.push('URL');}
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,{
      method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data:data2})
    });
    return{statusCode:200,headers,body:JSON.stringify({success:true,row,company:rec.company,mode,info:v,filled})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
