const{getParticipants}=require('./sheets-helper');
const RESEND_API_KEY=process.env.RESEND_API_KEY;
const OFFICE_EMAIL='tok@yumeplanning.jp';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;

const SIGNATURE=`・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・
今後のイベント開催予定（ホールドお願いします）
2026年9月18日札幌開催
2026年10月29日京都開催
2026年11月27日沖縄開催(変更）
2026年12月22日東京開催
▼イベント事務局募集中
https://forms.gle/Yno7VWDZEKnBefqV7
▼スタートアップ会員募集要項
https://bit.ly/4xd1CJG
▼スタートアップ入会説明会／下記からご都合の良い日時をお選びください。
https://coubic.com/jssa/3008775
下記のガイダンスを事前にお読みください。
https://www.yumeplanning.jp/guidance/
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
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=RAW`,{
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
        targetCompany:r[6]||'',score:r[7]||'',status:r[8]||'未通知'
      }));
      const batches={};
      for(const it of items){
        if(!batches[it.batchId]){
          batches[it.batchId]={batchId:it.batchId,createdAt:it.createdAt,userId:it.userId,userCompany:it.userCompany,userName:it.userName,userEmail:it.userEmail,status:it.status,companies:[]};
        }
        batches[it.batchId].companies.push({rowIndex:it.rowIndex,targetCompany:it.targetCompany,score:it.score,status:it.status});
        // バッチ全体のステータスは「1件でも未通知があれば未通知」とする
        if(it.status==='未通知')batches[it.batchId].status='未通知';
      }
      const list=Object.values(batches).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
      return{statusCode:200,headers,body:JSON.stringify({success:true,batches:list})};
    }

    if(action==='sendCompanyNames'){
      // ③ 岡代表が確認した企業名のみをユーザーにメール送信する
      const{batchId,rowIndexes,userEmail,userName,companies}=body;
      if(!userEmail)return{statusCode:400,headers,body:JSON.stringify({error:'送信先メールアドレスがありません'})};
      const list=(companies||[]).map((c,i)=>`${i+1}. ${c}`).join('\n');
      const mailText=`${userName||''} 様\n\n日本スタートアップ支援協会（JSSA）の岡隆宏です。\n平素よりお世話になっております。\n\nご登録いただいたご希望条件をもとに、AIマッチングシステムにて相性の良い企業様を選定いたしましたので、以下の通りご案内いたします。\n\n【マッチング企業一覧】\n${list}\n\nこの中で面談・情報交換をご希望される企業様がございましたら、本メールに返信する形で会社名をお知らせください。\n担当役職者の方をこちらで選定の上、あらためてご連絡いたします。\n\n${SIGNATURE}`;
      const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'tok@yumeplanning.jp',to:[userEmail],reply_to:OFFICE_EMAIL,subject:'【JSSA】マッチング企業のご案内',html:`<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:10px;"><div style="background:#0B0F1A;padding:14px 20px;border-radius:8px;margin-bottom:20px;"><span style="background:#639922;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">JSSA</span><span style="color:#fff;font-size:13px;margin-left:8px;">日本スタートアップ支援協会</span></div><div style="font-size:14px;color:#374151;line-height:1.8;">${mailText.replace(/\n/g,'<br>')}</div></div>`})});
      const resData=await res.json();
      if(!res.ok)return{statusCode:500,headers,body:JSON.stringify({error:'メール送信失敗: '+JSON.stringify(resData)})};
      if(Array.isArray(rowIndexes)){
        for(const idx of rowIndexes){await updateCell(token,'マッチング結果',idx,'I','企業名送信済み');}
      }
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'企業名一覧を送信しました'})};
    }

    if(action==='addRequest'){
      // ④ ユーザーからのメール返信を受けて、岡代表が手動で「会いたいリクエスト」を追加する
      const{userId,userCompany,userName,userEmail,targetCompany,targetPosition,message,matchReason}=body;
      const requestId=`req_${Date.now()}`;
      const createdAt=new Date().toISOString();
      await appendRow(token,'会いたいリクエスト',[requestId,userId||'',targetCompany||'',targetPosition||'','リクエスト受付',createdAt,createdAt,userCompany||'',userName||'',userEmail||'',message||'',matchReason||'','']);
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'リクエストを追加しました'})};
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
      const mailText=emailBody||`${targetHeader}\n\n日本スタートアップ支援協会（JSSA）の岡隆宏と申します。\n平素よりお世話になっております。\n\nこの度、弊協会の会員企業より、貴社との面談・情報交換のご希望をいただきましたので、ご紹介させていただきます。\n${recommendText}\n【ご紹介する会員】\n会社名：${memberCompany||'—'}\n役職　：${memberPosition||'—'}\n氏名　：${memberName||'—'}\nメール：${memberEmail||'—'}\n会社HP：${memberWebsite||'—'}\nFacebook：${memberFacebook||'—'}\n\nご都合がよろしければ、直接${memberName}様にご連絡いただけますと幸いです。\nご不明な点がございましたら、私（岡）までお気軽にご連絡ください。\n\n今後ともどうぞよろしくお願いいたします。\n\n${SIGNATURE}`;
      const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'tok@yumeplanning.jp',to:[toEmail],reply_to:OFFICE_EMAIL,subject:`【ご紹介】${memberCompany} ${memberName}様のご紹介`,html:`<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:10px;"><div style="background:#0B0F1A;padding:14px 20px;border-radius:8px;margin-bottom:20px;"><span style="background:#639922;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">JSSA</span><span style="color:#fff;font-size:13px;margin-left:8px;">日本スタートアップ支援協会</span></div><div style="font-size:14px;color:#374151;line-height:1.8;">${mailText.replace(/\n/g,'<br>')}</div></div>`})});
      const resData=await res.json();
      if(!res.ok)return{statusCode:500,headers,body:JSON.stringify({error:'メール送信失敗: '+JSON.stringify(resData)})};
      if(rowIndex)await updateCell(token,'会いたいリクエスト',rowIndex,'E','推薦メール送信済');
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'推薦メールを送信しました'})};
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
      // ゴミ箱に移動
      const deletedAt=new Date().toISOString();
      await appendRow(token,'ゴミ箱',[requestId||'',userId||'',targetCompany||'',targetPosition||'',status||'',createdAt||'',updatedAt||'',memberCompany||'',memberName||'',memberEmail||'',message||'',matchReason||'',recommendation||'',deletedAt]);
      // 元の行を削除
      const sheetId=await getSheetId(token,'会いたいリクエスト');
      await deleteRow(token,sheetId,rowIndex);
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'ゴミ箱に移動しました'})};
    }

    if(action==='restore'){
      const{rowIndex,requestId,userId,targetCompany,targetPosition,status,createdAt,updatedAt,memberCompany,memberName,memberEmail,message,matchReason,recommendation}=body;
      // 会いたいリクエストに復元
      await appendRow(token,'会いたいリクエスト',[requestId||'',userId||'',targetCompany||'',targetPosition||'',status||'',createdAt||'',updatedAt||'',memberCompany||'',memberName||'',memberEmail||'',message||'',matchReason||'',recommendation||'']);
      // ゴミ箱から削除
      const sheetId=await getSheetId(token,'ゴミ箱');
      await deleteRow(token,sheetId,rowIndex);
      return{statusCode:200,headers,body:JSON.stringify({success:true,message:'復元しました'})};
    }

    return{statusCode:400,headers,body:JSON.stringify({error:'不明なアクションです'})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
