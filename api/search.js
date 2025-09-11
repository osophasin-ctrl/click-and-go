// /api/search.js
const API_URL = 'https://affiliateapi7643.agoda.com/affiliateservice/lt_v1';

function num(v, def=0){ const n=parseInt(v,10); return Number.isFinite(n)?n:def; }
function parseQuery(req){
  return {
    cityName : String(req.query.q || req.query.city || 'Bangkok').trim(),
    checkIn  : String(req.query.checkin  || ''),
    checkOut : String(req.query.checkout || ''),
    rooms    : num(req.query.rooms,1),
    adults   : num(req.query.adults,2),
    children : num(req.query.children,0),
    currency : String(req.query.currency||'THB').toUpperCase(),
    language : String(req.query.lang||'en-us').toLowerCase(),
    resultCount:num(req.query.resultCount,10),
    sortOrder:String(req.query.sortOrder||'PRICE').toUpperCase()
  };
}

function mockItems(criteria,cid){
  const city=criteria.cityName;
  const ci=criteria.checkIn||'2025-09-24', co=criteria.checkOut||'2025-09-25';
  const dl=`https://www.agoda.com/partners/partnersearch.aspx?cid=${cid}&city=${encodeURIComponent(city)}&checkIn=${ci}&checkOut=${co}`;
  return [
    {id:'52120188',name:`${city} Riverside Hotel`,city,starRating:4,reviewScore:8.7,reviewCount:214,
     imageUrl:'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=1200&auto=format&fit=crop',
     priceFrom:1290,currency:criteria.currency,freeCancellation:true,mealPlan:'Breakfast included',deeplink:dl},
    {id:'52120199',name:`${city} Central Hotel`,city,starRating:3,reviewScore:8.0,reviewCount:120,
     imageUrl:'https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?q=80&w=1200&auto=format&fit=crop',
     priceFrom:990,currency:criteria.currency,freeCancellation:false,mealPlan:'',deeplink:dl},
    {id:'52120222',name:'Old Town Boutique',city,starRating:5,reviewScore:9.1,reviewCount:84,
     imageUrl:'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=1200&auto=format&fit=crop',
     priceFrom:2890,currency:criteria.currency,freeCancellation:true,mealPlan:'Breakfast included',deeplink:dl},
  ];
}

export default async function handler(req,res){
  const started=Date.now();
  const key=process.env.AGODA_API_KEY||'';
  const [cidFromKey]=key.split(':');
  const CID=process.env.AGODA_CID||cidFromKey||'1949420';
  const input=parseQuery(req);
  const debug=String(req.query.debug||'')==='1';

  if(!key){
    return res.status(200).json({ok:true,source:'mock',note:'Missing key',query:input,total:3,items:mockItems(input,CID),tookMs:Date.now()-started});
  }

  const roomsArray=Array.from({length:Math.max(1,input.rooms)}).map(()=>({adults:input.adults,children:input.children,childAges:[]}));

  const payload={
    criteria:{
      area:{ name: input.cityName },   // <-- แก้เป็น object
      checkInDate:input.checkIn,
      checkOutDate:input.checkOut,
      rooms:roomsArray,
      currency:input.currency,
      language:input.language,
      sortOrder:input.sortOrder,
      resultCount:input.resultCount
    }
  };

  let status=0, raw='';
  try{
    const resp=await fetch(API_URL,{
      method:'POST',
      headers:{Authorization:key,cid:CID,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(payload)
    });
    status=resp.status;
    raw=await resp.text();
    if(resp.ok){
      let json;try{json=JSON.parse(raw);}catch{}
      if(json&&!json.error){
        return res.status(200).json({ok:true,source:'agoda',query:input,total:json.total||json.items?.length||0,items:json.items||[],tookMs:Date.now()-started});
      }
    }
    return res.status(200).json({ok:true,source:'mock',note:`agoda api http ${status}`,query:input,total:3,items:mockItems(input,CID),_raw:debug?raw:undefined,tookMs:Date.now()-started});
  }catch(e){
    return res.status(200).json({ok:true,source:'mock',note:`fetch error ${e.message}`,query:input,total:3,items:mockItems(input,CID),_raw:debug?raw:undefined,tookMs:Date.now()-started});
  }
}
