const ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY;
exports.handler=async(event)=>{
if(event.httpMethod==="OPTIONS"){return{statusCode:200,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type"},body:""};}
if(event.httpMethod!=="POST"){return{statusCode:405,body:"Method Not Allowed"};}
const headers={"Access-Control-Allow-Origin":"*","Content-Type":"application/json"};
try{
const{results,aiParams,index,userProfile}=JSON.parse(event.body);
if(!ANTHROPIC_API_KEY||!results||results.length===0){return{statusCode:200,headers,body:JSON.stringify({success:true,results})};}
const{industry=[],listed="",scale=[],position=[],region=[]}=aiParams||{};
const p=results[index||0];
if(!p){return{statusCode:200,headers,body:JSON.stringify({success:true,result:null})};}

const supportArea=userProfile&&userProfile.supportArea?userProfile.supportArea:'';
const targetRound=userProfile&&userProfile.targetRound?userProfile.targetRound:'';
const investmentIndustry=userProfile&&userProfile.investmentIndustry?userProfile.investmentIndustry:'';
const fundingRound=userProfile&&userProfile.fundingRound?userProfile.fundingRound:'';
const challenges=userProfile&&userProfile.challenges?userProfile.challenges:'';
const userContext=supportArea?`支援者の得意領域：${supportArea}${targetRound?'、対応可能なラウンド：'+targetRound:''}${investmentIndustry?'、投資先業種：'+investmentIndustry:''}`:fundingRound?`調達ラウンド：${fundingRound}、事業課題：${challenges}`:'';

const prompt="あなたはJSSAエコシステムマッチングツールのAIアシスタントです。\n以下の1社についてマッチ理由・推薦理由・おすすめの第一声を日本語で生成してください。\n\nユーザー情報：\n"+(userContext||"情報なし")+"\n\nアンケート回答：\n- 希望業種："+(industry.join("、")||"こだわらない")+"\n- 上場/未上場："+(listed||"こだわらない")+"\n- 企業規模："+(scale.join("、")||"こだわらない")+"\n\n対象企業："+p.company+"（"+(p.industry||"業種不明")+"・"+(p.prefecture||"地域不明")+"・スコア"+p.score+"%）\n企業特徴："+p.features+"\n\n【重要】推薦理由はユーザーの得意領域・投資先業種・対応ラウンド・課題を前提に生成してください。例えば資金調達・投資が得意領域なら投資・資金調達の観点から、医療への投資実績があれば医療分野の観点から推薦理由を書いてください。\n\n以下のJSON形式のみで回答してください：{\"matchReason\":\"マッチ理由50文字以内\",\"recommendation\":\"推薦理由200文字以内。ユーザーの得意領域・投資先業種・対応ラウンドを前提に具体的に\",\"firstMessage\":\"メッセージ提案300文字前後。推薦理由を加味して、面談を申し込む具体的なメッセージ文を生成してください\"}";

const aiRes=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:600,messages:[{role:"user",content:prompt}]})});
const aiData=await aiRes.json();
const aiText=aiData.content&&aiData.content[0]?aiData.content[0].text:"{}";
const cleanText=aiText.replace(/```json|```/g,"").trim();
const ai=JSON.parse(cleanText);
return{statusCode:200,headers,body:JSON.stringify({success:true,index:index||0,result:{matchReason:ai.matchReason||"",recommendation:ai.recommendation||"",firstMessage:ai.firstMessage||""}})};
}catch(e){return{statusCode:500,headers,body:JSON.stringify({error:e.message})};}
};
