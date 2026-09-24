const{getParticipants,getIntroducedCompanies,saveMatchResultsForReview}=require('./sheets-helper');
const ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY;
const rateLimit=new Map();
function checkRateLimit(ip){const now=Date.now();const entry=rateLimit.get(ip)||{count:0,reset:now+60000};if(now>entry.reset){entry.count=0;entry.reset=now+60000;}entry.count++;rateLimit.set(ip,entry);return entry.count<=30;}

function industryMatch(selected,target){
  if(!selected||selected.length===0)return true;
  if(selected.includes('こだわらない'))return true;
  if(!target)return false;
  for(let i=0;i<selected.length;i++){
    if(selected[i]===target)return true;
  }
  return false;
}

function positionMatch(selected,target){
  if(!selected||selected.length===0)return true;
  if(selected.includes('こだわらない'))return true;
  if(!target)return false;
  const t=target;
  for(let i=0;i<selected.length;i++){
    const s=selected[i];
    if(s==='経営者・役員'&&(t.includes('代表')||t.includes('社長')||t.includes('会長')||t.includes('役員')||t.includes('取締役')||t.includes('CEO')||t.includes('COO')||t.includes('CFO')||t.includes('CTO')||t.includes('CMO')||t.includes('CSO')||t.includes('執行役員')||t.includes('理事長')||t.includes('理事')||t.includes('組合長')||t.includes('院長')||t.includes('校長')||t.includes('所長')||t.includes('館長')||t.includes('局長')))return true;
    if(s==='事業部長・本部長'&&(t.includes('事業部長')||t.includes('本部長')||t.includes('統括')||t.includes('カントリーマネージャー')))return true;
    if(s==='部長・次長'&&(t.includes('部長')||t.includes('次長')||t.includes('Director')||t.includes('Head of')))return true;
    if(s==='課長・マネージャー'&&(t.includes('課長')||t.includes('マネージャー')||t.includes('Manager')||t.includes('マネジャー')))return true;
    if(s==='係長・リーダー・主任'&&(t.includes('係長')||t.includes('リーダー')||t.includes('主任')||t.includes('Leader')||t.includes('チーフ')))return true;
    if(s==='一般社員'&&(t.includes('社員')||t.includes('スタッフ')||t.includes('Staff')||t.includes('アシスタント')||t.includes('Assistant')||t.includes('担当')))return true;
    if(s==='専門職・コンサルタント・研究職など'&&(t.includes('コンサルタント')||t.includes('Consultant')||t.includes('研究')||t.includes('士')||t.includes('師')||t.includes('アナリスト')||t.includes('エンジニア')||t.includes('デザイナー')||t.includes('ドクター')||t.includes('Doctor')||t.includes('Ph.D')))return true;
  }
  return false;
}

function scaleMatch(selected,scale){
  if(!selected||selected.length===0)return true;
  if(selected.includes('こだわらない'))return true;
  if(!scale||scale==='不明')return selected.includes('こだわらない');
  for(let i=0;i<selected.length;i++){
    if(selected[i]===scale)return true;
  }
  return false;
}

function regionMatch(selected,prefecture){
  if(!selected||selected.length===0)return true;
  if(selected.includes('こだわらない'))return true;
  if(!prefecture)return false;
  const pf=prefecture;
  for(let j=0;j<selected.length;j++){
    const r=selected[j];
    if(r==="東京都のみ"&&pf.startsWith("東京都"))return true;
    if(r==="関東"&&(pf.startsWith("東京都")||pf.startsWith("神奈川県")||pf.startsWith("埼玉県")||pf.startsWith("千葉県")||pf.startsWith("茨城県")||pf.startsWith("栃木県")||pf.startsWith("群馬県")))return true;
    if(r==="関西"&&(pf.startsWith("大阪府")||pf.startsWith("兵庫県")||pf.startsWith("京都府")||pf.startsWith("滋賀県")||pf.startsWith("奈良県")||pf.startsWith("和歌山県")))return true;
    if(r==="北海道"&&pf.startsWith("北海道"))return true;
    if(r==="東北"&&(pf.startsWith("青森県")||pf.startsWith("岩手県")||pf.startsWith("宮城県")||pf.startsWith("秋田県")||pf.startsWith("山形県")||pf.startsWith("福島県")))return true;
    if(r==="中部"&&(pf.startsWith("愛知県")||pf.startsWith("静岡県")||pf.startsWith("岐阜県")||pf.startsWith("三重県")||pf.startsWith("新潟県")||pf.startsWith("富山県")||pf.startsWith("石川県")||pf.startsWith("福井県")||pf.startsWith("山梨県")||pf.startsWith("長野県")))return true;
    if(r==="中国・四国"&&(pf.startsWith("広島県")||pf.startsWith("岡山県")||pf.startsWith("山口県")||pf.startsWith("鳥取県")||pf.startsWith("島根県")||pf.startsWith("香川県")||pf.startsWith("愛媛県")||pf.startsWith("高知県")||pf.startsWith("徳島県")))return true;
    if(r==="九州・沖縄"&&(pf.startsWith("福岡県")||pf.startsWith("佐賀県")||pf.startsWith("長崎県")||pf.startsWith("熊本県")||pf.startsWith("大分県")||pf.startsWith("宮崎県")||pf.startsWith("鹿児島県")||pf.startsWith("沖縄県")))return true;
  }
  return false;
}

function capitalMatch(selected,capitalStr){
  if(!selected||selected.length===0)return true;
  if(selected.includes('こだわらない'))return true;
  if(!capitalStr||capitalStr==='不明'||capitalStr==='')return selected.includes('こだわらない');
  const str=capitalStr.replace(/,/g,'').replace(/，/g,'');
  const num=parseFloat(str.replace(/[^0-9.]/g,''));
  if(isNaN(num))return selected.includes('こだわらない');
  let manYen=num;
  if(str.includes('億'))manYen=num*10000;
  else if(str.includes('千万'))manYen=num*1000;
  else if(str.includes('百万'))manYen=num*100;
  else if(str.includes('万'))manYen=num;
  for(let i=0;i<selected.length;i++){
    const s=selected[i];
    if(s==='〜1000万円'&&manYen<=1000)return true;
    if(s==='〜5000万円'&&manYen<=5000)return true;
    if(s==='〜1億円'&&manYen<=10000)return true;
    if(s==='〜5億円'&&manYen<=50000)return true;
    if(s==='〜10億円'&&manYen<=100000)return true;
    if(s==='10億円〜'&&manYen>100000)return true;
  }
  return false;
}

function foundedMatch(selected,foundedStr){
  if(!selected||selected.length===0)return true;
  if(selected.includes('こだわらない'))return true;
  if(!foundedStr||foundedStr==='不明'||foundedStr==='')return selected.includes('こだわらない');
  const year=parseInt(foundedStr.replace(/[^0-9]/g,''));
  if(isNaN(year))return selected.includes('こだわらない');
  const currentYear=new Date().getFullYear();
  const age=currentYear-year;
  for(let i=0;i<selected.length;i++){
    const s=selected[i];
    if(s==='1年以内'&&age<=1)return true;
    if(s==='2年以内'&&age<=2)return true;
    if(s==='3年以内'&&age<=3)return true;
    if(s==='5年以内'&&age<=5)return true;
    if(s==='10年以内'&&age<=10)return true;
    if(s==='10年以上'&&age>10)return true;
  }
  return false;
}

function employeesMatch(selected,empStr){
  if(!selected||selected.length===0)return true;
  if(selected.includes('こだわらない'))return true;
  if(!empStr||empStr==='不明'||empStr==='')return selected.includes('こだわらない');
  const num=parseInt(empStr.replace(/[^0-9]/g,''));
  if(isNaN(num))return selected.includes('こだわらない');
  for(let i=0;i<selected.length;i++){
    const s=selected[i];
    if(s==='〜5名'&&num<=5)return true;
    if(s==='〜10名'&&num<=10)return true;
    if(s==='〜30名'&&num<=30)return true;
    if(s==='〜50名'&&num<=50)return true;
    if(s==='〜100名'&&num<=100)return true;
    if(s==='〜500名'&&num<=500)return true;
    if(s==='500名〜'&&num>500)return true;
  }
  return false;
}

function hiringMatch(selected,hiringStr){
  if(!selected||selected.length===0)return true;
  if(selected.includes('こだわらない'))return true;
  if(!hiringStr||hiringStr==='不明'||hiringStr==='')return selected.includes('こだわらない');
  const num=parseInt(hiringStr.replace(/[^0-9]/g,''));
  if(isNaN(num))return selected.includes('こだわらない');
  for(let i=0;i<selected.length;i++){
    const s=selected[i];
    if(s==='〜5名'&&num<=5)return true;
    if(s==='〜10名'&&num<=10)return true;
    if(s==='〜50名'&&num<=50)return true;
    if(s==='〜100名'&&num<=100)return true;
    if(s==='100名〜'&&num>100)return true;
  }
  return false;
}

function maMatch(selected,maStr){
  if(!selected||selected==='')return true;
  if(selected==='こだわらない')return true;
  if(!maStr||maStr==='不明'||maStr==='')return selected==='こだわらない';
  const hasMA=maStr!==''&&maStr!=='実績なし'&&maStr!=='なし'&&maStr!=='0件';
  if(selected==='あり'&&hasMA)return true;
  if(selected==='なし'&&!hasMA)return true;
  return false;
}

exports.handler=async(event)=>{
if(event.httpMethod==="OPTIONS"){return{statusCode:200,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type"},body:""};}
if(event.httpMethod!=="POST"){return{statusCode:405,body:"Method Not Allowed"};}
const headers={"Access-Control-Allow-Origin":"*","Content-Type":"application/json"};
const ip=event.headers["x-forwarded-for"]?event.headers["x-forwarded-for"].split(",")[0]:"unknown";
if(!checkRateLimit(ip)){return{statusCode:429,headers,body:JSON.stringify({error:"リクエストが多すぎます。"})};}
try{
const body=JSON.parse(event.body);
const isOld=!!(body.company||body.name)&&!body.answers&&!body.userInfo;
let industry,listed,scale,position,years,capital,employees,hiring,ma,region,userId;
if(isOld){
industry=Array.isArray(body.industries)?body.industries:[];
listed=body.wantListingStatus||"";
scale=Array.isArray(body.wantEmployeeScales)?body.wantEmployeeScales:[];
position=Array.isArray(body.wantPosition)?body.wantPosition:[];
years=[];capital=[];employees=[];hiring=[];ma="";region=[];
userId=body.company||"";
}else{
const ans=body.answers||body;
const ui=body.userInfo||{};
industry=Array.isArray(ans.industry)?ans.industry:[];
listed=ans.listed||"";
scale=Array.isArray(ans.scale)?ans.scale:[];
position=Array.isArray(ans.position)?ans.position:[];
years=Array.isArray(ans.years)?ans.years:[];
capital=Array.isArray(ans.capital)?ans.capital:[];
employees=Array.isArray(ans.employees)?ans.employees:[];
hiring=Array.isArray(ans.hiring)?ans.hiring:[];
ma=ans.ma||"";
region=Array.isArray(ans.region)?ans.region:[];
userId=ui.id||ui.company||"";
}
const all=await getParticipants();
const exc=new Set();
// 既にこの会員へ企業名を案内済み（マッチング結果シートで「企業名送信済み」）の企業は候補から除外する
const normCo=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
if(userId){try{const introduced=await getIntroducedCompanies(userId);introduced.forEach(c=>exc.add(normCo(c)));if(introduced.length)console.log(`案内済み企業を除外: ${introduced.length}社`);}catch(e){console.error('getIntroducedCompanies error:',e.message);}}

// 企業名ピンポイント検索
// ※アプリ2の仕様：検索結果もユーザーには非公開。管理者レビュー用に保存するのみ。
const companySearch=body.companySearch||'';
if(companySearch){
  const matched=all.filter(p=>p.company&&p.company.includes(companySearch));
  const ui2=body.userInfo||{};
  const aiParamsForSearch={industry,listed,scale,position,region};
  try{
    await saveMatchResultsForReview(userId,ui2,matched.map(p=>({company:p.company,score:'',cardRow:p.cardRow||0})),aiParamsForSearch);
  }catch(e){console.error('saveMatchResultsForReview error:',e.message);}
  return{statusCode:200,headers,body:JSON.stringify({success:true,submitted:true,count:matched.length})};
}

const cands=all.filter(p=>{
if(!p||!p.company)return false;
if(exc.has(normCo(p.company)))return false;
const pl=p.listingStatus==="上場企業";
if(listed==="上場企業のみ"&&!pl)return false;
if(listed==="未上場のみ"&&pl)return false;
if(!industryMatch(industry,p.industry))return false;
if(!positionMatch(position,p.position))return false;
if(!scaleMatch(scale,p.scale))return false;
if(region.length>0&&region[0]!=='こだわらない'&&!regionMatch(region,p.prefecture))return false;
if(!capitalMatch(capital,p.capital))return false;
if(!foundedMatch(years,p.founded))return false;
if(!employeesMatch(employees,p.employees))return false;
if(!hiringMatch(hiring,p.hiring))return false;
if(!maMatch(ma,p.ma))return false;
// URLが不明の企業を除外（こだわらない以外の条件が1つでもある場合）
const hasFilter=(industry.length>0&&!industry.includes('こだわらない'))||
  (listed&&listed!=='こだわらない')||
  (scale.length>0&&!scale.includes('こだわらない'))||
  (position.length>0&&!position.includes('こだわらない'))||
  (years.length>0&&!years.includes('こだわらない'))||
  (capital.length>0&&!capital.includes('こだわらない'))||
  (employees.length>0&&!employees.includes('こだわらない'))||
  (hiring.length>0&&!hiring.includes('こだわらない'))||
  (ma&&ma!=='こだわらない')||
  (region.length>0&&!region.includes('こだわらない'));
if(hasFilter&&(!p.siteUrl||p.siteUrl==='不明'||p.siteUrl===''))return false;
return true;
});
const scored=[];
for(let i=0;i<cands.length;i++){
const p=cands[i];let s=10;
const pi=p.industry||"";const ps=p.scale||p.employeeScale||"";const pp=p.position||"";const pm=p.ma||"";const pf=p.prefecture||"";
if(industry.length>0){for(let j=0;j<industry.length;j++){if(industry[j]&&industry[j]!=="こだわらない"&&pi&&pi===industry[j]){s+=30;break;}}}
if(position.length>0){if(position.indexOf("こだわらない")>=0){s+=10;}else if(pp){for(let j=0;j<position.length;j++){if(position[j]&&pp.includes(position[j])){s+=20;break;}}}}
if(scale.length>0){if(scale.indexOf("こだわらない")>=0){s+=5;}else if(ps){for(let j=0;j<scale.length;j++){if(scale[j]&&ps===scale[j]){s+=15;break;}}}}
if(listed==="こだわらない"||listed==="")s+=5;
if(capital.length>0&&capital[0]!=='こだわらない')s+=3;
if(employees.length>0&&employees[0]!=='こだわらない')s+=3;
if(hiring.length>0&&hiring[0]!=='こだわらない')s+=3;
if(years.length>0&&years[0]!=='こだわらない')s+=3;
if(region.length>0&&pf){for(let j=0;j<region.length;j++){const r=region[j];if(!r)continue;let m=false;if(r==="東京都のみ"&&pf.startsWith("東京都"))m=true;if(r==="関東"&&(pf.startsWith("東京都")||pf.startsWith("神奈川県")||pf.startsWith("埼玉県")||pf.startsWith("千葉県")))m=true;if(r==="関西"&&(pf.startsWith("大阪府")||pf.startsWith("兵庫県")||pf.startsWith("京都府")))m=true;if(r==="北海道"&&pf.startsWith("北海道"))m=true;if(r==="九州・沖縄"&&(pf.startsWith("福岡県")||pf.startsWith("沖縄県")))m=true;if(m){s+=10;break;}}}
const pct=Math.min(Math.round((s/150)*100),99);
scored.push({id:p.id||"",cardRow:p.cardRow||0,company:p.company||"",department:p.department||"",position:pp,industry:pi,scale:ps,prefecture:pf,listed:p.listed||"",employees:p.employees||"",founded:p.founded||"",capital:p.capital||"",hiring:p.hiring||"",ma:pm,features:p.features||"",siteUrl:p.siteUrl||"",score:pct,matchReason:"",recommendation:"",firstMessage:""});
}
scored.sort((a,b)=>b.score-a.score);
const top100=scored.slice(0,100);
// ※アプリ2の仕様：マッチング結果はユーザーには非表示。
// スコア上位の企業をレビュー用シートに保存し、岡代表が管理画面で確認した上で
// 企業名のみをメールで通知するフローに変更。
const ui=body.userInfo||{};
const aiParams={industry,listed,scale,position,region};
try{
  await saveMatchResultsForReview(userId,ui,top100.map(m=>({company:m.company,score:m.score,cardRow:m.cardRow})),aiParams);
}catch(e){console.error('saveMatchResultsForReview error:',e.message);}
return{statusCode:200,headers,body:JSON.stringify({success:true,submitted:true,count:top100.length})};
}catch(e){return{statusCode:500,headers,body:JSON.stringify({error:e.message,stack:e.stack})};}
};
