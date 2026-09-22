const{getUserBalance,MONTHLY_LIMITS}=require('./sheets-helper');

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'},body:''};
  if(event.httpMethod!=='POST')return{statusCode:405,body:'Method Not Allowed'};
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  try{
    const{userId,memberRank}=JSON.parse(event.body||'{}');
    if(!userId)return{statusCode:400,headers,body:JSON.stringify({error:'userId is required'})};
    const rank=memberRank||'default';
    const limit=MONTHLY_LIMITS[rank]||MONTHLY_LIMITS['default'];
    const balance=await getUserBalance(userId,limit);
    const remaining=Math.max(balance,0);
    return{statusCode:200,headers,body:JSON.stringify({success:true,memberRank:rank,limit,remaining})};
  }catch(e){
    return{statusCode:500,headers,body:JSON.stringify({error:e.message})};
  }
};
