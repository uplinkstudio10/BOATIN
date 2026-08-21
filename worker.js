// BOATIN Worker | Secrets: NVIDIA_API_KEY, GROQ_API_KEY
const CHAT="https://integrate.api.nvidia.com/v1",GENAI="https://ai.api.nvidia.com/v1/genai",GROQ="https://api.groq.com/openai/v1";
const ORIGINS=["https://uplinkstudio10.github.io","http://localhost:3000","http://127.0.0.1:5500","http://localhost:5500","http://127.0.0.1:3000"];
const GENAI_PATHS={"black-forest-labs/flux.1-dev":"black-forest-labs/flux.1-dev","black-forest-labs/flux.1-schnell":"black-forest-labs/flux.1-schnell","stabilityai/stable-diffusion-3.5-large":"stabilityai/stable-diffusion-3.5-large","qwen/qwen-image":"qwen/qwen-image","qwen/qwen-image-2512":"qwen/qwen-image-2512"};
const WX={0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Rime fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",80:"Rain showers",81:"Rain showers",82:"Violent showers",95:"Thunderstorm",96:"Thunderstorm+hail",99:"Thunderstorm+heavy hail"};

function cors(origin){
  const o=origin||"";
  let ok=ORIGINS.includes(o)||!o;
  if(!ok&&o){try{const h=new URL(o).hostname;ok=h.endsWith(".github.io")||h==="localhost"||h==="127.0.0.1";}catch{}}
  return{"Access-Control-Allow-Origin":ok?(o||"*"):ORIGINS[0],"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization, Accept","Access-Control-Max-Age":"86400",Vary:"Origin"};
}
const json=(d,s,h)=>new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json; charset=utf-8",...h}});
async function passthrough(res,h){
  const ct=res.headers.get("Content-Type")||"";
  if(ct.includes("text/event-stream"))return new Response(res.body,{status:res.status,headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform",Connection:"keep-alive",...h}});
  return new Response(await res.text(),{status:res.status,headers:{"Content-Type":ct||"application/json; charset=utf-8",...h}});
}
function normImage(data){
  if(!data||typeof data!=="object")return data;
  const it=data?.data?.[0]||data?.images?.[0]||data?.artifacts?.[0];
  const b64=it?.b64_json||it?.base64||it?.b64||data?.b64_json||data?.image;
  const url=it?.url||it?.image_url?.url||data?.url||data?.image_url;
  if(url)return{data:[{url}]};
  if(typeof b64==="string")return{data:[{b64_json:b64.replace(/^data:image\/\w+;base64,/,"")}]};
  return data;
}
function errMsg(d,s){return(typeof d?.error==="string"&&d.error)||d?.error?.message||d?.message||d?.detail||`HTTP ${s}`;}
async function openaiImage(key,model,prompt,extra={}){
  const res=await fetch(`${CHAT}/images/generations`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({model,prompt,n:1,...extra})});
  const text=await res.text();let data;try{data=JSON.parse(text);}catch{data={raw:text};}
  return{ok:res.ok,status:res.status,data};
}
function genaiBody(model,prompt){
  const m=String(model||"");
  if(/flux\.1-schnell/i.test(m))return{prompt,samples:1,steps:4,cfg_scale:0,seed:0,width:1024,height:1024};
  if(/flux\.1-dev/i.test(m))return{prompt,samples:1,steps:25,cfg_scale:3.5,seed:0,width:1024,height:1024};
  if(/stable-diffusion/i.test(m))return{prompt,cfg_scale:5,steps:25,seed:0};
  if(/qwen-image/i.test(m))return{prompt,seed:0};
  return{prompt,seed:0};
}
async function genaiImage(key,model,prompt){
  const res=await fetch(`${GENAI}/${GENAI_PATHS[model]||model}`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(genaiBody(model,prompt))});
  const text=await res.text();let data;try{data=JSON.parse(text);}catch{data={raw:text};}
  return{ok:res.ok,status:res.status,data};
}

async function runWebSearch(query){
  const q=String(query||"").trim();if(!q)return{text:"",sources:[],error:"Empty query"};
  const enc=encodeURIComponent(q);
  const providers=[
    // Wikipedia family
    ["wiki",`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc}&utf8=1&format=json&srlimit=10`,"wiki"],
    ["wiki-open",`https://en.wikipedia.org/w/api.php?action=opensearch&search=${enc}&limit=10&namespace=0&format=json`,"wiki-open"],
    ["wikinews",`https://en.wikinews.org/w/api.php?action=query&list=search&srsearch=${enc}&utf8=1&format=json&srlimit=5`,"wiki"],
    ["wikiquote",`https://en.wikiquote.org/w/api.php?action=query&list=search&srsearch=${enc}&utf8=1&format=json&srlimit=5`,"wiki"],
    // DuckDuckGo
    ["ddg-api",`https://api.duckduckgo.com/?q=${enc}&format=json&no_html=1&skip_disambig=1`,"ddg"],
    ["ddg-html",`https://html.duckduckgo.com/html/?q=${enc}`,"html"],
    ["ddg-lite",`https://lite.duckduckgo.com/lite/?q=${enc}`,"html"],
    // Social / Community
    ["reddit",`https://www.reddit.com/search.json?q=${enc}&sort=relevance&limit=10`,"reddit"],
    ["hn",`https://hn.algolia.com/api/v1/search?query=${enc}&tags=story&hitsPerPage=10`,"hn"],
    ["devto",`https://dev.to/api/articles?per_page=8&tag=&top=1&_=${enc}`,"devto"],
    // Tech / Code
    ["so",`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${enc}&site=stackoverflow&pagesize=8`,"stackexchange"],
    ["superuser",`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${enc}&site=superuser&pagesize=5`,"stackexchange"],
    ["github",`https://api.github.com/search/repositories?q=${enc}&sort=stars&per_page=8`,"github"],
    ["npm",`https://registry.npmjs.org/-/v1/search?text=${enc}&size=8`,"npm"],
    ["pypi",`https://pypi.org/pypi?%3Aaction=search&term=${enc}&submit=search`,"html"],
    // Science / Academic
    ["arxiv",`https://export.arxiv.org/api/query?search_query=all:${enc}&start=0&max_results=8`,"arxiv"],
    ["pubmed",`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc}&retmax=8&retmode=json`,"pubmed"],
    ["openalex",`https://api.openalex.org/works?search=${enc}&per-page=8&select=title,doi,publication_year,primary_location`,"openalex"],
    // Books / Literature
    ["openlibrary",`https://openlibrary.org/search.json?q=${enc}&limit=8&fields=title,author_name,first_publish_year,key`,"openlibrary"],
    // News / Media
    ["mediawiki-news",`https://en.wikinews.org/w/api.php?action=query&list=search&srsearch=${enc}&utf8=1&format=json&srlimit=5`,"wiki"],
    // General knowledge APIs
    ["itunes",`https://itunes.apple.com/search?term=${enc}&limit=8&entity=software,album,movie`,"itunes"],
    ["gutendex",`https://gutendex.com/books?search=${enc}`,"gutendex"],
  ];
  const sources=[],seen=new Set(),chunks=[];let lastError="No results",okCount=0;
  const junk=(title,href)=>{try{const host=new URL(href).hostname.toLowerCase();if(/external-content\.duckduckgo|gstatic/i.test(host))return true;if(/\.(png|jpe?g|gif|webp|svg|ico|css|js)(\?|$)/i.test(href))return true;return/^!?\[?Image\b/i.test(title||"")||(title||"").length<3;}catch{return true;}};
  const push=(title,url,snippet="")=>{if(sources.length>=50)return;try{const u=new URL(String(url).replace(/[),.;]+$/,""));if(!/^https?:$/.test(u.protocol))return;let t=String(title||"").replace(/\s+/g," ").trim().replace(/^!\[[^\]]*\]\s*/g,"").replace(/^\[[^\]]*\]\s*/g,"").trim();if(junk(t,u.href))return;const key=u.hostname.replace(/^www\./,"")+u.pathname;if(seen.has(key))return;seen.add(key);sources.push({title:t||u.hostname.replace(/^www\./,""),url:u.href,domain:u.hostname.replace(/^www\./,""),snippet:String(snippet||"").slice(0,240)});}catch{}};
  const extract=raw=>{const re=/\[([^\]]{2,180})\]\((https?:\/\/[^)\s]+)\)/g;let m;while((m=re.exec(raw)))push(m[1],m[2],m[1]);const uddg=/uddg=([^&"']+)/g;while((m=uddg.exec(raw))){try{push("",decodeURIComponent(m[1]));}catch{}}(String(raw).match(/https?:\/\/[^\s<>"')]+/g)||[]).slice(0,20).forEach(u=>{if(!u.includes("duckduckgo.com/l/"))push("",u);});};
  const fetchOne=async([name,url,type])=>{const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),8000);try{const res=await fetch(url,{headers:{Accept:"text/plain, application/json, */*","User-Agent":"Mozilla/5.0 (compatible; BOATIN/19)"},signal:ctrl.signal});if(!res.ok){lastError=`${name} HTTP ${res.status}`;return null;}const text=await res.text();if(!text||text.trim().length<20)return null;return{name,type,text};}catch(e){lastError=e.message||lastError;return null;}finally{clearTimeout(t);}};
  for(const hit of await Promise.all(providers.map(fetchOne))){
    if(!hit)continue;okCount++;const{name,type,text}=hit;
    if(type==="ddg"){try{const j=JSON.parse(text),bits=[];if(j.Heading)bits.push("Topic: "+j.Heading);if(j.AbstractText)bits.push(j.AbstractText);if(j.Answer)bits.push(j.Answer);(j.RelatedTopics||[]).slice(0,8).forEach(x=>{if(x.Text)bits.push("• "+x.Text);if(x.FirstURL&&x.Text)push(x.Text,x.FirstURL,x.Text);});(j.Results||[]).slice(0,6).forEach(r=>{if(r.Text&&r.FirstURL)push(r.Text,r.FirstURL,r.Text);});if(j.AbstractURL)push(j.Heading||"Abstract",j.AbstractURL,j.AbstractText||"");if(bits.length)chunks.push("[DuckDuckGo]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="wiki"){try{const list=JSON.parse(text)?.query?.search||[],bits=[];list.forEach(h=>{const title=h.title||"",snippet=String(h.snippet||"").replace(/<[^>]+>/g,""),url="https://en.wikipedia.org/wiki/"+encodeURIComponent(title.replace(/ /g,"_"));bits.push(`• ${title}: ${snippet}`);push(title+" — Wikipedia",url,snippet);});if(bits.length)chunks.push("[Wikipedia]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="wiki-open"){try{const oj=JSON.parse(text),titles=oj[1]||[],descs=oj[2]||[],urls=oj[3]||[],bits=[];titles.forEach((ti,i)=>{bits.push("• "+ti+(descs[i]?": "+descs[i]:""));if(urls[i])push(ti,urls[i],descs[i]||"");});if(bits.length)chunks.push("[Wikipedia related]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="reddit"){try{const posts=(JSON.parse(text).data&&JSON.parse(text).data.children)||[],bits=[];posts.forEach(p=>{const d=p.data||{};if(!d.title)return;const url="https://www.reddit.com"+(d.permalink||"");bits.push("• "+d.title);push(d.title,url,d.selftext?String(d.selftext).slice(0,200):d.title);});if(bits.length)chunks.push("[Reddit]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="stackexchange"){try{const items=JSON.parse(text).items||[],bits=[];items.forEach(it=>{if(!it.title||!it.link)return;bits.push("• "+it.title+(it.is_answered?" ✓":""));push(it.title,it.link,it.title);});if(bits.length)chunks.push("[Stack Overflow]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="hn"){try{const hits=JSON.parse(text).hits||[],bits=[];hits.forEach(it=>{if(!it.title)return;const url=it.url||("https://news.ycombinator.com/item?id="+it.objectID);bits.push("• "+it.title);push(it.title,url,it.title);});if(bits.length)chunks.push("[Hacker News]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="github"){try{const items=JSON.parse(text).items||[],bits=[];items.forEach(r=>{if(!r.full_name)return;const desc=r.description?` — ${r.description.slice(0,120)}`:"";bits.push(`• ${r.full_name}⭐${r.stargazers_count||0}${desc}`);push(r.full_name,r.html_url,r.description||"");});if(bits.length)chunks.push("[GitHub]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="npm"){try{const objects=JSON.parse(text).objects||[],bits=[];objects.forEach(o=>{const p=o.package||{};if(!p.name)return;bits.push(`• ${p.name} — ${(p.description||"").slice(0,100)}`);push(p.name+" (npm)",`https://www.npmjs.com/package/${p.name}`,p.description||"");});if(bits.length)chunks.push("[npm]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="arxiv"){try{const entries=[...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)],bits=[];entries.slice(0,8).forEach(m=>{const e=m[1];const title=(e.match(/<title>([\s\S]*?)<\/title>/)||[])[1]?.replace(/\s+/g," ").trim()||"";const url=(e.match(/<id>([\s\S]*?)<\/id>/)||[])[1]?.trim()||"";const summary=(e.match(/<summary>([\s\S]*?)<\/summary>/)||[])[1]?.replace(/\s+/g," ").trim().slice(0,200)||"";if(!title)return;bits.push(`• ${title}`);push(title+" [arXiv]",url,summary);});if(bits.length)chunks.push("[arXiv]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="pubmed"){try{const ids=JSON.parse(text).esearchresult?.idlist||[],bits=[];ids.slice(0,8).forEach(id=>{const url=`https://pubmed.ncbi.nlm.nih.gov/${id}/`;bits.push(`• PubMed:${id}`);push(`PubMed Article ${id}`,url,"");});if(bits.length)chunks.push("[PubMed]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="openalex"){try{const results=JSON.parse(text).results||[],bits=[];results.forEach(w=>{if(!w.title)return;const doi=w.doi?`https://doi.org/${w.doi.replace("https://doi.org/","")}`:w.primary_location?.landing_page_url||"";const yr=w.publication_year?` (${w.publication_year})`:"";bits.push(`• ${w.title}${yr}`);if(doi)push(w.title+" [paper]",doi,`Published ${w.publication_year||"?"}`);});if(bits.length)chunks.push("[OpenAlex/Academic]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="openlibrary"){try{const docs=JSON.parse(text).docs||[],bits=[];docs.forEach(b=>{if(!b.title)return;const authors=(b.author_name||[]).slice(0,2).join(", ");const yr=b.first_publish_year?` (${b.first_publish_year})`:"";const url=`https://openlibrary.org${b.key}`;bits.push(`• ${b.title}${yr}${authors?" — "+authors:""}`);push(b.title+" [book]",url,authors);});if(bits.length)chunks.push("[Open Library]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="devto"){try{const articles=JSON.parse(text)||[],bits=[];articles.slice(0,8).forEach(a=>{if(!a.title||!a.url)return;bits.push(`• ${a.title}`);push(a.title+" [dev.to]",a.url,a.description||"");});if(bits.length)chunks.push("[Dev.to]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="itunes"){try{const results=JSON.parse(text).results||[],bits=[];results.slice(0,6).forEach(r=>{const name=r.trackName||r.collectionName||r.artistName||"";const url=r.trackViewUrl||r.collectionViewUrl||"";if(!name||!url)return;bits.push(`• ${name}`);push(name,url,r.description?String(r.description).slice(0,120):"");});if(bits.length)chunks.push("[iTunes/App Store]\n"+bits.join("\n"));}catch{}continue;}
    if(type==="gutendex"){try{const results=JSON.parse(text).results||[],bits=[];results.slice(0,6).forEach(b=>{if(!b.title)return;const authors=(b.authors||[]).map(a=>a.name).join(", ");const url=`https://www.gutenberg.org/ebooks/${b.id}`;bits.push(`• ${b.title}${authors?" — "+authors:""}`);push(b.title+" [Gutenberg]",url,authors);});if(bits.length)chunks.push("[Project Gutenberg]\n"+bits.join("\n"));}catch{}continue;}
    extract(text);
    const plain=text.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ");
    const cleaned=plain.replace(/\r/g,"").split("\n").map(l=>l.trim()).filter(l=>l.length>25&&!/^(Share|Sign in|Accept|Cookie|Privacy|Menu|Subscribe|DuckDuckGo)/i.test(l)).slice(0,90).join("\n");
    if(cleaned.length>80)chunks.push(`[${name}]\n${cleaned.slice(0,7000)}`);
  }
  const deep=sources.filter(s=>!/(wikipedia\.org|reddit\.com|duckduckgo|google\.|bing\.|yahoo\.|stackoverflow\.com|ycombinator\.com)/i.test(s.domain||"")).slice(0,5);
  if(deep.length){(await Promise.all(deep.map(async s=>{try{const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),6000);try{const res=await fetch(s.url,{headers:{Accept:"text/html,text/plain,*/*","User-Agent":"Mozilla/5.0"},signal:ctrl.signal});if(!res.ok)return null;const raw=await res.text();if(!raw||raw.length<120)return null;const body=raw.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s{2,}/g," ").trim();return body&&body.length>=120?`[Full: ${s.title} | ${s.url}]\n${body.slice(0,4000)}`:null;}finally{clearTimeout(t);}}catch{return null;}}))).filter(Boolean).forEach(c=>chunks.push(c));}
  let combined=chunks.join("\n\n---\n\n");
  if(combined.trim().length<60&&sources.length)combined=sources.map(s=>`${s.title} (${s.url}) ${s.snippet||""}`).join("\n");
  return{text:combined.slice(0,28000),sources:sources.slice(0,20),providerCount:okCount,error:okCount===0?lastError:undefined};
}

async function runWeather(query){
  const q=String(query||"").trim()||"Dhaka";
  const geo=await(await fetch("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(q)+"&count=1&language=en&format=json")).json();
  const place=geo?.results?.[0];if(!place)return{error:"Location not found: "+q};
  const{latitude:lat,longitude:lon}=place,name=[place.name,place.admin1,place.country].filter(Boolean).join(", ");
  const wx=await(await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=3`)).json();
  const cur=wx.current||{},daily=wx.daily||{},days=[];
  (daily.time||[]).slice(0,3).forEach((date,i)=>days.push({date,max:daily.temperature_2m_max?.[i],min:daily.temperature_2m_min?.[i],rain:daily.precipitation_sum?.[i],condition:WX[daily.weather_code?.[i]]||""}));
  return{location:name,latitude:lat,longitude:lon,current:{temperature:cur.temperature_2m,feelsLike:cur.apparent_temperature,humidity:cur.relative_humidity_2m,precipitation:cur.precipitation,windSpeed:cur.wind_speed_10m,windDir:cur.wind_direction_10m,condition:WX[cur.weather_code]||("Code "+cur.weather_code),weatherCode:cur.weather_code,time:cur.time},daily:days,units:wx.current_units||{}};
}

export default{async fetch(request,env){
  const h=cors(request.headers.get("Origin")||"");
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:h});
  const path=new URL(request.url).pathname.replace(/\/+$/,"")||"/";
  try{
    if(request.method==="GET"&&(path==="/"||path==="/health"))return json({status:"ok",hasKey:!!env.NVIDIA_API_KEY,hasGroq:!!env.GROQ_API_KEY,routes:["/","/image","/image/edit","/search","/weather","/health"]},200,h);
    if(request.method!=="POST")return json({error:"Method not allowed"},405,h);
    if(path==="/"){
      const raw=await request.text();
      let body;try{body=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400,h);}
      const model=String(body.model||"");
      const isGroq=/^groq\//.test(model)||/^(llama-3\.1-8b-instant|llama-3\.3-70b-versatile|gemma2-9b-it|mixtral-8x7b-32768)/.test(model);
      if(isGroq){
        if(!env.GROQ_API_KEY)return json({error:"GROQ_API_KEY secret missing. Cloudflare → Worker → Settings → Variables → GROQ_API_KEY"},500,h);
        body.model=model.replace(/^groq\//,"");
        return passthrough(await fetch(`${GROQ}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(body)}),h);
      }
      if(!env.NVIDIA_API_KEY)return json({error:"NVIDIA_API_KEY secret missing"},500,h);
      return passthrough(await fetch(`${CHAT}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${env.NVIDIA_API_KEY}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(body)}),h);
    }
    if(!env.NVIDIA_API_KEY&&path!=="/search"&&path!=="/weather")return json({error:"NVIDIA_API_KEY secret missing"},500,h);
    if(path==="/image"){
      let body;try{body=await request.json();}catch{return json({error:"Invalid JSON"},400,h);}
      const{model,prompt}=body;if(!model||!prompt)return json({error:"model and prompt required"},400,h);
      if(/flux\.|stable-diffusion|qwen-image/i.test(String(model))){
        const t2=await genaiImage(env.NVIDIA_API_KEY,model,prompt);if(t2.ok)return json(normImage(t2.data)||t2.data,200,h);
        let t1=await openaiImage(env.NVIDIA_API_KEY,model,prompt,{response_format:"b64_json"});if(t1.ok)return json(normImage(t1.data)||t1.data,200,h);
        t1=await openaiImage(env.NVIDIA_API_KEY,model,prompt);if(t1.ok)return json(normImage(t1.data)||t1.data,200,h);
        const status=t2.status||t1.status||404,data=t2.data||t1.data||{};
        return json({error:errMsg(data,status),status,model,hint:status===422?"Bad image params":(status===404?"Image model not on this tier.":undefined),nvidia:data},status>=400&&status<600?status:502,h);
      }
      let t1=await openaiImage(env.NVIDIA_API_KEY,model,prompt,{response_format:"b64_json"});if(t1.ok)return json(normImage(t1.data)||t1.data,200,h);
      t1=await openaiImage(env.NVIDIA_API_KEY,model,prompt);if(t1.ok)return json(normImage(t1.data)||t1.data,200,h);
      const t2=await genaiImage(env.NVIDIA_API_KEY,model,prompt);if(t2.ok)return json(normImage(t2.data)||t2.data,200,h);
      const status=t2.status||t1.status||404,data=t2.data||t1.data||{};
      return json({error:errMsg(data,status),status,model,hint:status===404?"Image model not on this tier.":undefined,nvidia:data},status>=400&&status<600?status:502,h);
    }
    if(path==="/image/edit"){
      const ct=request.headers.get("Content-Type")||"";if(!ct.includes("multipart/form-data"))return json({error:"Expects multipart/form-data"},400,h);
      return passthrough(await fetch(`${CHAT}/images/edits`,{method:"POST",headers:{Authorization:`Bearer ${env.NVIDIA_API_KEY}`,Accept:"application/json"},body:await request.formData()}),h);
    }
    if(path==="/search"){
      let body;try{body=await request.json();}catch{return json({error:"Invalid JSON"},400,h);}
      const query=body.query||body.q||"";if(!String(query).trim())return json({error:"Missing query"},400,h);
      const result=await runWebSearch(query);if(result.error&&!result.text)return json(result,502,h);return json(result,200,h);
    }
    if(path==="/weather"){
      let body={};try{body=await request.json();}catch{}
      try{const result=await runWeather(body.query||body.q||body.city||body.location||"Dhaka");return json(result,result.error?404:200,h);}
      catch(e){return json({error:"Weather failed",details:e?.message||String(e)},502,h);}
    }
    return json({error:"Route not found",path,routes:["POST /","POST /image","POST /image/edit","POST /search","POST /weather","GET /health"]},404,h);
  }catch(err){return json({error:"Proxy error",details:err?.message||String(err)},500,h);}
}};
