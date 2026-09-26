const{getParticipants,setUserBalance,MONTHLY_LIMITS,personKey,isNewerCard,changeRequestBalance,getPriorityLists,priorityTier}=require('./sheets-helper');
const RESEND_API_KEY=process.env.RESEND_API_KEY;
const ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY;
const OFFICE_EMAIL='tok@yumeplanning.jp';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;

const SIGNATURE=`・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・
今後のイベント開催予定（ホールドお願いします）
2026年10月29日京都開催https://peatix.com/event/5096892
2026年11月27日沖縄開催https://peatix.com/event/5079069
2026年12月22日東京開催（制作中）
▼協会総合案内スライド（スタートアップ会員、スポンサー会員、サポート会員）
https://bit.ly/4hurkVp
▼イベント事務局募集中
https://forms.gle/Yno7VWDZEKnBefqV7
▼スタートアップ会員募集要項
https://bit.ly/4xd1CJG
▼スタートアップ入会説明会／下記からご都合の良い日時をお選びください。
https://coubic.com/jssa/3008775
・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・
一般社団法人　日本スタートアップ支援協会
代表理事　岡　隆宏
http://www.facebook.com/oka.takahiro.5
【協会本部】〒530-0001大阪府大阪市北区梅田1丁目2番2号大阪駅前第2ビル12-12
【東京支部】〒103-0026 東京都中央区日本橋兜町9-11-902
tok@yumeplanning.jp
http://www.yumeplanning.jp/
・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・`;

async function getToken(){
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

async function updateCell(token,sheet,row,col,val){
  const id=process.env.GOOGLE_SHEET_ID;
  const range=`${sheet}!${col}${row}`;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[[val]]})});
}

async function getSheetId(token,sheetName){
  const id=process.env.GOOGLE_SHEET_ID;
  const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}`,{headers:{'Authorization':`Bearer ${token}`}});
  const data=await res.json();
  const sheet=data.sheets?.find(s=>s.properties.title===sheetName);
  return sheet?.properties?.sheetId;
}

async function deleteRow(token,sheetId,rowIndex){
  const id=process.env.GOOGLE_SHEET_ID;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({requests:[{deleteDimension:{range:{sheetId,dimension:'ROWS',startIndex:rowIndex-1,endIndex:rowIndex}}}]})
  });
}

async function appendRow(token,sheetName,values){
  const id=process.env.GOOGLE_SHEET_ID;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(sheetName+'!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({values:[values]})
  });
}

function checkAuth(event){
  const auth=(event.headers.authorization||'').replace('Bearer ','');
  const xauth=event.headers['x-admin-password']||'';
  return auth===ADMIN_PASSWORD||xauth===ADMIN_PASSWORD;
}

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization,x-admin-password'},body:''};
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if(!checkAuth(event))return{statusCode:401,headers,body:JSON.stringify({error:'認証失敗'})};
  try{
    const body=JSON.parse(event.body||'{}');
    const action=body.action||(event.queryStringParameters||{}).action;
    const token=await getToken();

    if(action==='getMatchResults'){
      // マッチング結果シートを読み込み、バッチ（ユーザー1回分の診断）単位でグループ化して返す
      const rows=await getSheet(token,'マッチング結果');
      const items=rows.slice(1).map((r,i)=>({
        rowIndex:i+2,batchId:r[0]||'',createdAt:r[1]||'',userId:r[2]||'',
        userCompany:r[3]||'',userName:r[4]||'',userEmail:r[5]||'',
        targetCompany:r[6]||'',score:r[7]||'',status:r[8]||'未通知',
        aiParamsJson:r[9]||'',cardRow:parseInt(r[10])||0,memberRank:r[11]||'default'
      }));
      // 申込者自身のプロフィール情報（スタートアップ情報/支援者情報）をユーザー登録シートから取得
      const userRows=await getSheet(token,'ユーザー登録');
      const userMap={};
      userRows.slice(1).forEach(u=>{
        const uid=u[0]||'';
        if(!uid)return;
        const supporterFilled=u[17]||u[18]||u[19]||u[20]||u[25]||u[26];
        const startupFilled=u[12]||u[13]||u[14]||u[15]||u[16]||u[24];
        const profileType=supporterFilled?'supporter':(startupFilled?'startup':'');
        userMap[uid]={
          profileType,
          fundingRound:u[12]||'',fundingTarget:u[13]||'',challenges:u[14]||'',globalExpansion:u[15]||'',kpi:u[16]||'',
          supportCount:u[17]||'',supportArea:u[18]||'',investmentIndustry:u[19]||'',targetRound:u[20]||'',
          ma:u[21]||'',secondaryMarket:u[22]||'',hiringNeeds:u[23]||'',stockOption:u[24]||'',
          ventureInvestment:u[25]||'',lpInvestment:u[26]||''
        };
      });
      const batches={};
      for(const it of items){
        if(!batches[it.batchId]){
          let aiParams={};
          try{aiParams=JSON.parse(it.aiParamsJson||'{}');}catch(e){aiParams={};}
          batches[it.batchId]={batchId:it.batchId,createdAt:it.createdAt,userId:it.userId,userCompany:it.userCompany,userName:it.userName,userEmail:it.userEmail,status:it.status,aiParams,memberRank:it.memberRank,userProfile:userMap[it.userId]||null,companies:[]};
        }
        // 岡代表が「候補から外す」を押した企業は表示しない
        if(it.status==='除外')continue;
        batches[it.batchId].companies.push({rowIndex:it.rowIndex,targetCompany:it.targetCompany,score:it.score,status:it.status,cardRow:it.cardRow});
        // バッチ全体のステータスは「1件でも未通知があれば未通知」とする
        if(it.status==='未通知')batches[it.batchId].status='未通知';
      }
      const list=Object.values(batches).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
      return{statusCode:200,headers,body:JSON.stringify({success:true,batches:list})};
    }

    if(action==='excludeCompanies'){
      // マッチング結果から、ふさわしくない企業を候補から外す（行は消さずにステータスを「除外」にする）
      const{rowIndexes}=body;
      if(!Array.isArray(rowIndexes)||rowIndexes.length===0)return{statusCode:400,headers,body:JSON.stringify({error:'対象がありません'})};
      const id=process.env.GOOGLE_SHEET_ID;
      const data=rowIndexes.map(r=>({range:`マッチング結果!I${parseInt(r,10)}`,values:[['除外']]}));
      const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data})});
      if(!res.ok)return{statusCode:500,headers,body:JSON.stringify({error:'更新に失敗しました'})};
      return{statusCode:200,headers,body:JSON.stringify({success:true})};
    }

    if(action==='getCompanyDetails'){
      // マッチング結果の企業リストについて、名刺データの全項目とAIによる推薦理由をまとめて返す（10社程度の小口指定を想定）
      const{items,aiParams,applicant}=body;
      if(!Array.isArray(items)||items.length===0)return{statusCode:400,headers,body:JSON.stringify({error:'items is required'})};
      const cardRows=await getSheet(token,'名刺データ');
      const priorityLists=await getPriorityLists();
      const results=items.map(it=>{
        const rowIdx=it.cardRow;
        let row=(rowIdx&&rowIdx>1)?cardRows[rowIdx-1]:null;
        // 重複名刺の整理などで行がずれた場合は、会社名で探し直す
        const normC=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
        if(row&&it.company&&normC(row[0])!==normC(it.company))row=null;
        if(!row&&it.company){const hits=cardRows.slice(1).filter(r=>normC(r[0])===normC(it.company));row=hits.length?hits[hits.length-1]:null;}
        // 同じ人物の新しい名刺（異動・昇進後）があれば、そちらの部署・役職を表示する
        if(row){
          const key=personKey(row[0],row[3],row[4]);
          if(key){
            let best={values:row,cardRow:cardRows.indexOf(row)+1,cardDate:row[13]};
            cardRows.forEach((r,i)=>{if(i===0||r===row)return;if(personKey(r[0],r[3],r[4])!==key)return;const c={values:r,cardRow:i+1,cardDate:r[13]};if(isNewerCard(c,best))best=c;});
            row=best.values;
          }
        }
        if(!row){
          return{company:it.company||'',tier:priorityTier(it.company,priorityLists),score:it.score||'',found:false,department:'',position:'',name:'',email:'',zip:'',address:'',telOffice:'',telDept:'',telDirect:'',fax:'',mobile:'',siteUrl:'',cardDate:'',industry:'',scale:'',employees:'',founded:'',capital:'',listed:'',hiring:'',ma:'',features:'',facebook:''};
        }
        return{
          found:true,score:it.score||'',tier:priorityTier(it.company||row[0],priorityLists),
          company:row[0]||it.company||'',department:row[1]||'',position:row[2]||'',name:row[3]||'',
          email:row[4]||'',zip:row[5]||'',address:row[6]||'',telOffice:row[7]||'',telDept:row[8]||'',
          telDirect:row[9]||'',fax:row[10]||'',mobile:row[11]||'',siteUrl:row[12]||'',cardDate:row[13]||'',
          industry:row[14]||'',scale:row[15]||'',employees:row[16]||'',founded:row[17]||'',capital:row[18]||'',
          listed:row[19]||'',hiring:row[20]||'',ma:row[21]||'',features:row[22]||'',facebook:row[23]||''
        };
      });
      let enriched=results.map(r=>({...r,matchReason:'',recommendation:'',meetingBenefit:''}));
      if(ANTHROPIC_API_KEY){
        try{
          const ap=aiParams||{};
          const app=applicant||{};
          const appProfile=app.profile||{};
          const appDetails=[
            app.company?`申込者の会社名：${app.company}`:'',
            appProfile.challenges?`事業課題：${appProfile.challenges}`:'',
            appProfile.fundingRound?`調達ラウンド：${appProfile.fundingRound}`:'',
            appProfile.supportArea?`得意な支援領域：${appProfile.supportArea}`:'',
            appProfile.investmentIndustry?`投資先業種：${appProfile.investmentIndustry}`:''
          ].filter(Boolean).join('／');
          // 同じ会社の社員が複数いても、AIには会社ごとに1回だけ依頼する
          const normCo2=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
          const uniq=[];const idxOf=new Map();
          results.forEach(r=>{const k=normCo2(r.company);if(!idxOf.has(k)){idxOf.set(k,uniq.length);uniq.push(r);}});
          const list=uniq.map((r,i)=>`${i+1}. ${r.company}（${r.industry||'業種不明'}・${r.address||'地域不明'}・スコア${r.score}%）\n特徴：${r.features||'情報なし'}`).join('\n\n');
          const prompt=`あなたはJSSAエコシステムマッチングツールのAIアシスタントです。\n以下の企業リストについて、それぞれ次の3つを日本語で生成してください。\n\nアンケート回答：\n- 希望業種：${(ap.industry||[]).join('、')||'こだわらない'}\n- 上場/未上場：${ap.listed||'こだわらない'}\n- 企業規模：${(ap.scale||[]).join('、')||'こだわらない'}\n${appDetails?`\n申込者の情報：${appDetails}\n`:''}\n企業リスト：\n${list}\n\n① matchReason：マッチ理由（50文字以内）\n② recommendation：推薦理由（150文字以内）\n③ meetingBenefit：この企業（リストの各社）から見て、申込者と面談することのメリット（150文字程度、企業側の立場で前向きになれる具体的な内容）\n\n以下のJSON配列形式のみで回答してください（企業リストと同じ順番・同じ件数で）：\n[{"matchReason":"...","recommendation":"...","meetingBenefit":"..."}]`;
          const aiRes=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:3000,messages:[{role:'user',content:prompt}]})});
          const aiData=await aiRes.json();
          if(!aiRes.ok){
            console.error('Anthropic API error:',aiRes.status,JSON.stringify(aiData));
          }
          const aiText=aiData.content&&aiData.content[0]?aiData.content[0].text:'[]';
          console.log('AI raw response text:',aiText.slice(0,500));
          const cleanText=aiText.replace(/```json|```/g,'').trim();
          const aiArr=JSON.parse(cleanText);
          enriched=results.map(r=>{const a=aiArr[idxOf.get(normCo2(r.company))]||{};return{...r,matchReason:a.matchReason||'',recommendation:a.recommendation||'',meetingBenefit:a.meetingBenefit||''};});
        }catch(e){console.error('AI enrich error:',e.message,e.stack);}
      }
      return{statusCode:200,headers,body:JSON.stringify({success:true,companies:enriched})};
    }

    if(action==='sendCompanyNames'){
      // ③ 岡代表が確認した企業名（推薦理由付き）をユーザーにメール送信する
      const{batchId,rowIndexes,userEmail,userName,companies,companyDetails,userId,memberRank}=body;
      if(!userEmail)return{statusCode:400,headers,body:JSON.stringify({error:'送信先メールアドレスがありません'})};
      const details=(companyDetails&&companyDetails.length>0)?companyDetails:(companies||[]).map(c=>({name:c,overview:'',reason:''}));
      // 会員へのメールには番号と会社名のみを載せる（会社概要・推薦理由は載せない）
      const list=details.map((c,i)=>`${i+1}. ${c.name}\n会社概要：${c.overview||'（情報なし）'}\n推薦理由：${c.reason||'（推薦理由情報なし）'}`).join('\n\n');
      // 宛名に会社名・役職を入れるため、ユーザー登録シートから取得する（C列=会社名、D列=役職）
      let userCompany=body.userCompany||'',userPosition='';
      if(userId){try{const u=(await getSheet(token,'ユーザー登録')).find(r=>String(r[0]||'').trim()===String(userId));if(u){userCompany=String(u[2]||userCompany).trim();userPosition=String(u[3]||'').trim();}}catch(e){console.error('宛名情報の取得エラー:',e.message);}}
      const addressee=[userCompany,userPosition,`${userName||''} 様`].filter(Boolean).join('\n');
      const mailText=`${addressee}\n\nお疲れ様です。\n\n登録された希望条件をもとに、私が相性の良い企業様を選定しましたので、以下の通り案内します。\n\n【マッチング企業一覧】\n\n${list}\n\nこの中で面談・情報交換を希望される企業様がありましたら、本メールに返信する形で、番号と会社名（例：「1. ○○株式会社」）をお知らせください。複数社でも構いません。\nすでに商談済みの企業や、希望する企業がない場合は「該当なし」と返信ください。改めて選定します。\n\n${SIGNATURE}`;
      // 返信先を「reply+バッチID@受信用ドメイン」にすることで、自動処理側がどのマッチング結果への返信かを確実に特定できるようにする
      const inboundDomain=process.env.INBOUND_REPLY_DOMAIN||'reply.yumeplanning.jp';
      // バッチIDにはISO日時由来のコロン(:)等、メールアドレスのローカル部として不正な文字が含まれるため、
      // base64urlエンコードしてメールアドレスに埋め込む（受信側でデコードして元のバッチIDに戻す）
      const replyTo=batchId?`reply+${Buffer.from(String(batchId)).toString('base64url')}@${inboundDomain}`:OFFICE_EMAIL;
      const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'tok@yumeplanning.jp',to:[userEmail],bcc:[OFFICE_EMAIL],reply_to:replyTo,subject:'【JSSA】マッチング企業のご案内',html:`<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:10px;"><div style="background:#0B0F1A;padding:14px 20px;border-radius:8px;margin-bottom:20px;"><span style="background:#639922;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">JSSA</span><span style="color:#fff;font-size:13px;margin-left:8px;">日本スタートアップ支援協会</span></div><div style="font-size:14px;color:#374151;line-height:1.8;">${mailText.replace(/\n/g,'<br>')}</div></div>`})});
      const resData=await res.json();
      if(!res.ok)return{statusCode:500,headers,body:JSON.stringify({error:'メール送信失敗: '+JSON.stringify(resData)})};
      if(Array.isArray(rowIndexes)){
        for(const idx of rowIndexes){await updateCell(token,'マッチング結果',idx,'I','企業名送信済み');}
      }
      // ※リクエスト回数は企業名の案内時ではなく、会員が会いたい企業を返信（リクエスト）した時点で減らす
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'企業名一覧を送信しました'})};
    }

    if(action==='addRequest'){
      // ④ ユーザーからのメール返信を受けて、岡代表が手動で「会いたいリクエスト」を追加する
      const{userId,userCompany,userName,userEmail,targetCompany,targetPosition,message,matchReason}=body;
      const requestId=`req_${Date.now()}`;
      const createdAt=new Date().toISOString();
      await appendRow(token,'会いたいリクエスト',[requestId,userId||'',targetCompany||'',targetPosition||'','リクエスト受付',createdAt,createdAt,userCompany||'',userName||'',userEmail||'',message||'',matchReason||'','']);
      // 会員のリクエストとして1回減らす（アポが確定しなくても戻らない）
      let balance=null;
      if(userId){try{balance=await changeRequestBalance(userId,1,`リクエスト -1社（管理画面で登録：${targetCompany||''}）`);}catch(e){console.error('リクエスト回数の減算エラー:',e.message);}}
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'リクエストを追加しました',balance})};
    }

    if(action==='list'||action==='getRequests'){
      const rows=await getSheet(token,'会いたいリクエスト');
      const requests=rows.slice(1).map((r,i)=>({
        rowIndex:i+2,requestId:r[0]||'',userId:r[1]||'',targetCompany:r[2]||'',
        targetPosition:r[3]||'',status:r[4]||'リクエスト受付',createdAt:r[5]||'',
        updatedAt:r[6]||'',memberCompany:r[7]||'',memberName:r[8]||'',
        memberEmail:r[9]||'',message:r[10]||'',matchReason:r[11]||'',recommendation:r[12]||''
      })).reverse(); // 最新を最上段に表示
      return{statusCode:200,headers,body:JSON.stringify({success:true,requests})};
    }

    if(action==='getTrash'){
      const rows=await getSheet(token,'ゴミ箱');
      const items=rows.slice(1).map((r,i)=>({
        rowIndex:i+2,requestId:r[0]||'',userId:r[1]||'',targetCompany:r[2]||'',
        targetPosition:r[3]||'',status:r[4]||'',createdAt:r[5]||'',
        updatedAt:r[6]||'',memberCompany:r[7]||'',memberName:r[8]||'',
        memberEmail:r[9]||'',message:r[10]||'',matchReason:r[11]||'',recommendation:r[12]||'',
        deletedAt:r[13]||''
      })).reverse();
      return{statusCode:200,headers,body:JSON.stringify({success:true,items})};
    }

    if(action==='getMemberOverview'){
      // 紹介メール用に、会員自身の「事業概要」と、紹介先企業にとっての「面談メリット」をAIで生成し、会社HPと合わせて返す
      const{userId,targetCompany,matchReason}=body;
      if(!userId)return{statusCode:400,headers,body:JSON.stringify({error:'userIdが必要です'})};
      const userRows=await getSheet(token,'ユーザー登録');
      const idx=userRows.findIndex((r,i)=>i>0&&r[0]===userId);
      if(idx<0)return{statusCode:404,headers,body:JSON.stringify({error:'ユーザーが見つかりません'})};
      const u=userRows[idx];
      const website=u[7]||'';
      const profile={
        fundingRound:u[12]||'',fundingTarget:u[13]||'',challenges:u[14]||'',globalExpansion:u[15]||'',kpi:u[16]||'',
        supportCount:u[17]||'',supportArea:u[18]||'',investmentIndustry:u[19]||'',targetRound:u[20]||''
      };
      const isSupporter=!!(profile.supportCount||profile.supportArea||profile.investmentIndustry||profile.targetRound);
      let overview='';
      let meetingBenefit='';
      if(ANTHROPIC_API_KEY){
        try{
          const details=isSupporter
            ?`支援実績件数：${profile.supportCount||'不明'}／得意な支援領域：${profile.supportArea||'不明'}／投資先・支援先の業種：${profile.investmentIndustry||'不明'}／対応可能なラウンド：${profile.targetRound||'不明'}`
            :`調達ラウンド：${profile.fundingRound||'不明'}／調達希望額：${profile.fundingTarget||'不明'}／事業課題：${profile.challenges||'不明'}／海外展開：${profile.globalExpansion||'不明'}／主要KPI：${profile.kpi||'不明'}`;
          const prompt=`あなたはJSSA（日本スタートアップ支援協会）の紹介メール作成を支援するアシスタントです。\n以下の会員企業の情報をもとに、2つの文章を作成してください。\n\n会社名：${u[2]||''}\n立場：${isSupporter?'支援者（投資家・VC等）':'スタートアップ'}\n情報：${details}\n${targetCompany?`紹介先企業：${targetCompany}\n`:''}${matchReason?`マッチ理由：${matchReason}\n`:''}\n\n① 事業概要：他社に紹介するメールに載せる、この会員企業の事業概要。80文字程度の自然な日本語。\n② 面談メリット：紹介先企業（${targetCompany||'紹介先企業'}）から見て、この会員と面談することにどんなメリットがあるかを、150文字程度の自然な日本語で。紹介先企業の立場で読んで前向きになれる、具体的で説得力のある内容にしてください。\n\n以下のJSON形式のみで出力してください。前置きや説明文は不要です。\n{"overview":"①の文章","meetingBenefit":"②の文章"}`;
          const aiRes=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:500,messages:[{role:'user',content:prompt}]})});
          const aiData=await aiRes.json();
          const aiText=(aiData.content&&aiData.content[0]?aiData.content[0].text:'').trim();
          const cleanText=aiText.replace(/```json|```/g,'').trim();
          try{
            const parsed=JSON.parse(cleanText);
            overview=parsed.overview||'';
            meetingBenefit=parsed.meetingBenefit||'';
          }catch(pe){
            console.error('AI応答のJSON解析エラー:',pe.message,cleanText);
          }
        }catch(e){console.error('事業概要・面談メリット生成エラー:',e.message);}
      }
      return{statusCode:200,headers,body:JSON.stringify({success:true,website,overview,meetingBenefit})};
    }

    if(action==='getCompanyContacts'){
      // ⑤ 対象企業の役職者一覧を取得（同じ会社名で複数の名刺データがある場合に選択できるようにする）
      const{targetCompany}=body;
      if(!targetCompany)return{statusCode:400,headers,body:JSON.stringify({error:'企業名が指定されていません'})};
      const participants=await getParticipants();
      const seen=new Set();
      const contacts=participants.filter(p=>p.company===targetCompany).filter(p=>{
        const key=p.email||`${p.name}_${p.position}`;
        if(seen.has(key))return false;seen.add(key);return true;
      }).map(p=>({name:p.name||'',position:p.position||'',email:p.email||'',department:p.department||''}));
      return{statusCode:200,headers,body:JSON.stringify({success:true,contacts})};
    }

    if(action==='sendRecommendation'){
      const{rowIndex,targetCompany,targetPosition,memberCompany,memberName,memberEmail,memberPosition,memberWebsite,memberFacebook,emailBody,matchReason,targetContactEmail,targetContactName,targetContactPosition}=body;
      let toEmail=targetContactEmail;
      let toName=targetContactName;
      let toPosition=targetContactPosition||targetPosition;
      if(!toEmail){
        // 役職者が未選択の場合は従来通り会社名から自動検索（後方互換）
        const participants=await getParticipants();
        const target=participants.find(p=>p.company===targetCompany);
        toEmail=target?.email;
        toName=toName||target?.name;
        toPosition=toPosition||target?.position;
      }
      if(!toEmail)return{statusCode:404,headers,body:JSON.stringify({error:'送信先メールアドレスが見つかりません。役職者を選択してください。'})};
      const recommendText=matchReason?`\n【推薦理由】\n${matchReason}との判断により、ご推薦させていただきます。\n`:'';
      const targetHeader=`${targetCompany||''}${toPosition?' '+toPosition:''}${toName?' '+toName+'様':' 担当者様'}`;
      // 管理画面で編集した本文には署名が含まれないため、送信時に自動で署名を付ける（既に含まれていれば付けない）
      const mailText=emailBody?(emailBody.includes('代表理事　岡　隆宏')?emailBody:`${emailBody.trim()}\n\n${SIGNATURE}`):`${targetHeader}\n\n日本スタートアップ支援協会（JSSA）の岡隆宏と申します。\n平素よりお世話になっております。\n\nこの度、弊協会の会員企業より、貴社との面談・情報交換のご希望をいただきましたので、ご紹介させていただきます。\n${recommendText}\n【ご紹介する会員】\n会社名：${memberCompany||'—'}\n役職　：${memberPosition||'—'}\n氏名　：${memberName||'—'}\nメール：${memberEmail||'—'}\n会社HP：${memberWebsite||'—'}\nFacebook：${memberFacebook||'—'}\n\nご都合がよろしければ、直接${memberName}様にご連絡いただけますと幸いです。\nご不明な点がございましたら、私（岡）までお気軽にご連絡ください。\n\n今後ともどうぞよろしくお願いいたします。\n\n${SIGNATURE}`;
      const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'tok@yumeplanning.jp',to:[toEmail],bcc:[OFFICE_EMAIL],reply_to:OFFICE_EMAIL,subject:`【ご紹介】${memberCompany} ${memberName}様のご紹介`,html:`<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:10px;"><div style="background:#0B0F1A;padding:14px 20px;border-radius:8px;margin-bottom:20px;"><span style="background:#639922;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">JSSA</span><span style="color:#fff;font-size:13px;margin-left:8px;">日本スタートアップ支援協会</span></div><div style="font-size:14px;color:#374151;line-height:1.8;">${mailText.replace(/\n/g,'<br>')}</div></div>`})});
      const resData=await res.json();
      if(!res.ok)return{statusCode:500,headers,body:JSON.stringify({error:'メール送信失敗: '+JSON.stringify(resData)})};
      if(rowIndex)await updateCell(token,'会いたいリクエスト',rowIndex,'E','推薦メール送信済');
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'推薦メールを送信しました'})};
    }

    if(action==='updateMemberRank'){
      // 管理画面から会員ランクを直接変更する。ランクは招待コードシート側で管理されているため、
      // そのユーザーが使った請求書番号の行を探して会員ランク（G列）を書き換える。
      // あわせて今月分の残高も新しい上限にリセットする。
      const{userId,newRank}=body;
      if(!userId||!newRank)return{statusCode:400,headers,body:JSON.stringify({error:'userIdとnewRankが必要です'})};
      const userRows=await getSheet(token,'ユーザー登録');
      const uIdx=userRows.findIndex((r,i)=>i>0&&r[0]===userId);
      if(uIdx<0)return{statusCode:404,headers,body:JSON.stringify({error:'ユーザーが見つかりません'})};
      const inviteCode=userRows[uIdx][1]||'';
      if(!inviteCode)return{statusCode:400,headers,body:JSON.stringify({error:'このユーザーの請求書番号が見つかりません'})};
      const inviteRows=await getSheet(token,'招待コード');
      const iIdx=inviteRows.findIndex((r,i)=>i>0&&r[0]===inviteCode);
      if(iIdx<0)return{statusCode:404,headers,body:JSON.stringify({error:'対応する招待コードが見つかりません'})};
      await updateCell(token,'招待コード',iIdx+1,'G',newRank);
      const limit=MONTHLY_LIMITS[newRank]||MONTHLY_LIMITS['default'];
      try{await setUserBalance(userId,limit);}catch(e){console.error('残高更新エラー:',e.message);}
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:`会員ランクを「${newRank}」に変更し、今月の残高を${limit}にリセットしました`})};
    }

    if(action==='deactivateUser'){
      // 退会処理：ログインをブロックするが、プロフィール・履歴データは削除せずそのまま保持する
      const{userId}=body;
      if(!userId)return{statusCode:400,headers,body:JSON.stringify({error:'userIdが必要です'})};
      const userRows=await getSheet(token,'ユーザー登録');
      const idx=userRows.findIndex((r,i)=>i>0&&r[0]===userId);
      if(idx<0)return{statusCode:404,headers,body:JSON.stringify({error:'ユーザーが見つかりません'})};
      await updateCell(token,'ユーザー登録',idx+1,'AB','退会');
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'退会処理をしました'})};
    }

    if(action==='decline'){
      const{rowIndex,memberEmail,memberName,targetCompany}=body;
      if(memberEmail&&RESEND_API_KEY){
        const declineText=`${memberName} 様\n\nこの度は紹介リクエストをいただきありがとうございます。\n誠に恐れ入りますが、マッチングの成功確率が低いとの岡代表の判断により今回は${targetCompany}様へのご紹介を見送らせていただくこととなりました。申し訳ありません。\n\n引き続き最適なマッチングをサポートしてまいりますので、これに懲りずにまたご利用ください。\n\n${SIGNATURE}`;
        await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'tok@yumeplanning.jp',to:[memberEmail],reply_to:OFFICE_EMAIL,subject:'【ご連絡】紹介リクエストの結果について',html:`<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:10px;"><div style="background:#0B0F1A;padding:14px 20px;border-radius:8px;margin-bottom:20px;"><span style="background:#639922;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">JSSA</span><span style="color:#fff;font-size:13px;margin-left:8px;">日本スタートアップ支援協会</span></div><div style="font-size:14px;color:#374151;line-height:1.8;">${declineText.replace(/\n/g,'<br>')}</div></div>`})});
      }
      if(rowIndex)await updateCell(token,'会いたいリクエスト',rowIndex,'E','見送り');
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'見送り処理を完了しました'})};
    }

    if(action==='delete'){
      const{rowIndex,requestId,userId,targetCompany,targetPosition,status,createdAt,updatedAt,memberCompany,memberName,memberEmail,message,matchReason,recommendation}=body;
      // ゴミ箱に移動（見出し行が無ければ先に作成）
      const trashRows=await getSheet(token,'ゴミ箱');
      if(!trashRows.length||!trashRows[0]||trashRows[0][0]!=='リクエストID'){
        if(!trashRows.length||!(trashRows[0]||[]).some(v=>v)){
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/${encodeURIComponent('ゴミ箱!A1')}?valueInputOption=RAW`,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[['リクエストID','ユーザーID','相手企業名','相手担当者名','ステータス','リクエスト日時','処理日時','会員会社名','会員氏名','会員メール','メッセージ(第一声・返信本文)','マッチ理由','推薦理由・メモ','削除日時']]})});
        }
      }
      const deletedAt=new Date().toISOString();
      await appendRow(token,'ゴミ箱',[requestId||'',userId||'',targetCompany||'',targetPosition||'',status||'',createdAt||'',updatedAt||'',memberCompany||'',memberName||'',memberEmail||'',message||'',matchReason||'',recommendation||'',deletedAt]);
      // 元の行を削除
      const sheetId=await getSheetId(token,'会いたいリクエスト');
      await deleteRow(token,sheetId,rowIndex);
      // 未処理（リクエスト受付）のまま削除した場合は、誤登録とみなしてリクエスト回数を1回戻す。
      // 見送り・承認済みなど対応済みのリクエストは、アポの成否にかかわらず戻さない。
      if(userId&&(status||'リクエスト受付')==='リクエスト受付'){try{await changeRequestBalance(userId,-1,`削除のため回数を戻す +1（${targetCompany||''}）`);}catch(e){console.error('リクエスト回数の戻しエラー:',e.message);}}
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'ゴミ箱に移動しました'})};
    }

    if(action==='restore'){
      const{rowIndex,requestId,userId,targetCompany,targetPosition,status,createdAt,updatedAt,memberCompany,memberName,memberEmail,message,matchReason,recommendation}=body;
      // 会いたいリクエストに復元
      await appendRow(token,'会いたいリクエスト',[requestId||'',userId||'',targetCompany||'',targetPosition||'',status||'',createdAt||'',updatedAt||'',memberCompany||'',memberName||'',memberEmail||'',message||'',matchReason||'',recommendation||'']);
      // ゴミ箱から削除
      const sheetId=await getSheetId(token,'ゴミ箱');
      await deleteRow(token,sheetId,rowIndex);
      // 削除時に回数を戻した未処理リクエストを復元した場合は、もう一度1回減らす
      if(userId&&(status||'リクエスト受付')==='リクエスト受付'){try{await changeRequestBalance(userId,1,`復元のため -1社（${targetCompany||''}）`);}catch(e){console.error('リクエスト回数の減算エラー:',e.message);}}
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'復元しました'})};
    }

    return{statusCode:400,headers,body:JSON.stringify({error:'不明なアクションです'})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
