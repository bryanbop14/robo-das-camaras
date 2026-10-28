import * as cheerio from 'cheerio';
import {NextResponse} from 'next/server';
export const runtime='nodejs';
export const maxDuration=60;

const TIME_BUDGET=52000, MAX_PAGES=55, FETCH_TIMEOUT=3500;
const AGENT='RiolePublicContactResearch/0.3 (+public professional directory)';
const RE_EMAIL=/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const RE_PHONE=/(?:\+55[\s-]*)?\(?\d{2}\)?[\s-]*\d{4,5}[-.\s]?\d{4}/g;
const RE_RELEVANT=/vereador|parlamentar|servidor|equipe|quem.e.quem|estrutura|organograma|diretor|contat|transpar[eê]ncia|gabinete|secretaria|recursos.humanos|mesa.diretora/i;
const RE_PRIORITY=/\/parlamentar\/|vereadores|servidores|quem.e.quem|contato|sapl\./i;
const PATHS=['/','/processo-legislativo/vereadores','/vereadores','/parlamentares','/servidores','/quem-e-quem','/contatos','/contato','/estrutura-organizacional','/institucional','/recursos-humanos','/sitemap'];
const KNOWN={
 'PR:Abatiá':['https://www.abatia.pr.leg.br','https://abatia.pr.leg.br'],
 'PR:Almirante Tamandaré':['https://www.almirantetamandare.pr.leg.br'],
 'AM:Manaus':['https://www.cmm.am.gov.br'],
 'PA:Belém':['https://cmb.pa.gov.br'],
 'PR:Coronel Vivida':['https://www.camaracoronelvivida.pr.gov.br'],
 'PR:Cruzeiro do Oeste':['https://www.cmcruzeirodooeste.pr.gov.br'],
 'PR:Douradina':['https://www.douradina.pr.leg.br']
};
const slug=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const uniq=a=>[...new Set(a.filter(Boolean))];
function candidateDomains(city,uf){
 const s=slug(city), u=uf.toLowerCase();
 return uniq([...(KNOWN[uf+':'+city]||[]),
 'https://'+s+'.'+u+'.leg.br',
 'https://www.'+s+'.'+u+'.leg.br',
 'https://www.camara'+s+'.'+u+'.gov.br',
 'https://www.cm'+s+'.'+u+'.gov.br',
 'https://camara'+s+'.'+u+'.gov.br',
 'https://www.'+s+'.'+u+'.gov.br',
 'https://www.camarade'+s+'.'+u+'.gov.br']);
}
function acceptedHost(host,city,uf,additional=[]){
 host=host.toLowerCase();
 const s=slug(city),u=uf.toLowerCase();
 const allowed=[...(KNOWN[uf+':'+city]||[]).map(v=>new URL(v).hostname),'cmm.'+u+'.gov.br','cmb.'+u+'.gov.br',s+'.'+u+'.leg.br','camara'+s+'.'+u+'.gov.br','camarade'+s+'.'+u+'.gov.br','cm'+s+'.'+u+'.gov.br',s+'.'+u+'.gov.br',...additional];
 return allowed.some(d=>host===d||host.endsWith('.'+d));
}
function safeUrl(ref,base,city,uf,additional=[]){
 try{
  const u=new URL(ref,base);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!acceptedHost(u.hostname,city,uf,additional))return null;
  if(/\.(?:png|jpe?g|gif|svg|css|js|zip|docx?|xlsx?|mp[34]|pdf)(?:$|\?)/i.test(u.pathname))return null;
  u.hash='';return u.href;
 }catch{return null;}
}
async function fetchUrl(url,accept='text/html'){
 const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT);
 try{
  const response=await fetch(url,{headers:{'user-agent':AGENT,accept},cache:'no-store',redirect:'manual',signal:controller.signal});
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(response.status>=300&&response.status<400){
   return {status:response.status,redirect:response.headers.get('location')||''};
  }
  if(!response.ok)return {status:response.status};
  if(type.includes('application/json'))return {status:200,json:await response.json()};
  if(type.includes('text/html')||type.includes('text/plain')||!type)return {status:200,html:(await response.text()).slice(0,900000)};
  return {status:'unsupported'};
 }catch(e){return {status:e.name==='AbortError'?'timeout':'error',reason:e.message};}
 finally{clearTimeout(timer);}
}
const robotsCache=new Map();
async function robotsAllowed(url){
 const u=new URL(url),root=u.origin;
 if(!robotsCache.has(root)){
  const result=await fetchUrl(root+'/robots.txt','text/plain');
  if(result.status===429||String(result.status).startsWith('5')||['timeout','error'].includes(result.status)){robotsCache.set(root,{deny:true,groups:[]});}
  else{
   const groups=[];let agents=[],rules=[];
   for(const raw of (result.html||'').split(/\r?\n/)){
    const line=raw.replace(/#.*/,'').trim();
    if(!line){if(agents.length||rules.length){groups.push({agents,rules});agents=[];rules=[];}continue;}
    if(/^user-agent:/i.test(line)){if(rules.length){groups.push({agents,rules});agents=[];rules=[];}agents.push(line.split(':').slice(1).join(':').trim().toLowerCase());}
    if(/^(allow|disallow):/i.test(line))rules.push({allow:/^allow:/i.test(line),path:line.split(':').slice(1).join(':').trim()});
   }
   if(agents.length||rules.length)groups.push({agents,rules});
   robotsCache.set(root,{deny:false,groups});
  }
 }
 const data=robotsCache.get(root);if(data.deny)return false;
 const groups=data.groups.filter(g=>g.agents.includes('*')||g.agents.some(a=>a&&AGENT.toLowerCase().startsWith(a)));
 const rules=groups.flatMap(g=>g.rules).filter(r=>r.path&&u.pathname.startsWith(r.path)).sort((a,b)=>b.path.length-a.path.length);
 return !rules.length||rules[0].allow;
}
function getLinks(html,url,city,uf,additional){
 const $=cheerio.load(html);
 return uniq($('a[href]').map((_,a)=>safeUrl($(a).attr('href'),url,city,uf,additional)).get()).filter(x=>RE_RELEVANT.test(x)).sort((a,b)=>Number(RE_PRIORITY.test(b))-Number(RE_PRIORITY.test(a)));
}
function labelled(text,label){
 const regex=new RegExp('(?:^|\\s)'+label+'\\s*:\\s*(.{1,145}?)(?=\\s+(?:Nome Completo|Nome Parlamentar|Partido|Telefone|E-mail|Email|Homepage|Biografia|Número do Gabinete|Gabinete|Endereço|Mandato)\\s*:|$)','i');
 return regex.exec(text)?.[1]?.trim()||'';
}
function recordsFromHtml(html,url,city){
 const $=cheerio.load(html), records=[];
 $('script,style,nav,footer').remove();
 const text=$('body').text().replace(/\s+/g,' ').trim();
 const isProfile=/\/parlamentar\/\d+\/?(?:\?|$)/.test(url);
 if(isProfile){
  const name=labelled(text,'Nome Completo')||labelled(text,'Nome Parlamentar')||$('h1').first().text().trim();
  const email=(labelled(text,'E-mail|Email').match(RE_EMAIL)||[])[0]||'';
  const phone=(labelled(text,'Telefone').match(RE_PHONE)||[])[0]||'';
  if(name&&(email||phone))records.push({name,role:'Vereador(a)',email,phone,source:url,type:'perfil'});
  return records;
 }
 const selectors='article,.vereador,.parlamentar,.servidor,.contato,.contact-card,tr';
 $(selectors).slice(0,150).each((_,node)=>{
  const item=$(node),t=item.text().replace(/\s+/g,' ').trim();
  if(t.length<12||t.length>650)return;
  const emails=uniq(t.match(RE_EMAIL)||[]);
  if(!emails.length)return;
  const heading=item.find('h2,h3,h4,strong,b').first().text().replace(/\s+/g,' ').trim();
  const role=(t.match(/diretor(?:a)?(?: geral| legislativ[oa]| administrativ[oa])?|president[ea]|secret[aá]ri[oa]|vereador(?:a)?|assessor(?:a)?|comunicação|licitações|tecnologia/i)||[])[0]||'';
  if(!heading&&!role)return;
  const name=heading.length>2&&heading.length<95&&!heading.includes('@')?heading:'';
  for(const email of emails.slice(0,2)) records.push({name,role,email,phone:(t.match(RE_PHONE)||[])[0]||'',source:url,type:'diretório'});
 });
 // Contact information without a person is retained as an institutional record.
 const clean=$('main,#content,#content-core').first().text().replace(/\s+/g,' ')||text;
 for(const email of uniq(clean.match(RE_EMAIL)||[]).slice(0,30)){
  if(records.some(r=>r.email.toLowerCase()===email.toLowerCase()))continue;
  records.push({name:'',role:'Contato institucional',email,phone:(clean.match(RE_PHONE)||[])[0]||'',source:url,type:'geral'});
 }
 return records;
}
async function saplApi(host,city,uf,deadline){
 if(Date.now()>deadline-5000)return {records:[],links:[],attempt:null};
 const api='https://'+host+'/api/parlamentares/parlamentar/?page_size=100';
 if(!await robotsAllowed(api))return {records:[],links:[],attempt:{url:api,status:'robots'}};
 const result=await fetchUrl(api,'application/json');
 const data=result.json;
 const list=Array.isArray(data)?data:Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:[];
 const links=[],records=[];
 for(const person of list.slice(0,100)){
  const id=Number(person.id);
  if(!id||person.ativo===false)continue;
  const source='https://'+host+'/parlamentar/'+id;
  links.push(source);
  const email=String(person.email||person.email_institucional||'');
  const phone=String(person.telefone||'').match(RE_PHONE)?.[0]||'';
  const name=String(person.nome_completo||person.nome_parlamentar||person.nome||'');
  if(name&&(email||phone))records.push({name,role:'Vereador(a)',email,phone,source,type:'api-sapl'});
 }
 return {records,links,attempt:{url:api,status:result.status}};
}
function mergeContacts(items){
 const map=new Map();
 for(const c of items){
  if(!c.email&&!c.phone)continue;
  if(c.name&&c.name.length>110)continue;
  const key=c.email?'email:'+c.email.toLowerCase():(c.name?'name:'+slug(c.name):'phone:'+c.phone);
  const curr=map.get(key);
  const score=x=>(x.name?4:0)+(x.email?2:0)+(x.phone?2:0)+(x.type==='perfil'?3:0);
  if(!curr||score(c)>score(curr))map.set(key,c);
 }
 return [...map.values()].sort((a,b)=>(a.name||'ZZZ').localeCompare(b.name||'ZZZ','pt-BR'));
}
async function discoverBySearch(city,uf){
 const key=process.env.SERPER_API_KEY;
 if(!key)return [];
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3500);
 try{
  const response=await fetch('https://google.serper.dev/search',{method:'POST',headers:{'X-API-KEY':key,'Content-Type':'application/json'},body:JSON.stringify({q:'Câmara Municipal de '+city+' '+uf+' site oficial vereadores contatos',num:10}),signal:ctrl.signal});
  if(!response.ok)return [];
  const data=await response.json();
  return uniq((data.organic||[]).map(r=>{try{return new URL(r.link).origin}catch{return null}}).filter(Boolean));
 }catch{return [];}finally{clearTimeout(timer);}
}
export async function POST(request){
 try{
  const {city:rawCity,uf:rawUf,fast=false}=await request.json();
  const city=String(rawCity||'').trim(),uf=String(rawUf||'').toUpperCase();
  if(!/^[A-Z]{2}$/.test(uf)||city.length<2||city.length>90)return NextResponse.json({error:'Estado ou município inválido'},{status:400});
  const started=Date.now(),deadline=started+(fast?18000:TIME_BUDGET);
  const attempts=[],allRecords=[],visited=new Set(),allowedHosts=[];
  const candidates=uniq([...candidateDomains(city,uf),...await discoverBySearch(city,uf)]);
  let origin='',homeHtml='',pageCount=0;
  // Check candidates with bounded parallelism. The discovered domain must match the municipality and an official host format.
  for(let i=0;i<candidates.length&&Date.now()<deadline-(fast?3500:14000);i+=3){
   const batch=candidates.slice(i,i+3).filter(u=>{try{return acceptedHost(new URL(u).hostname,city,uf)}catch{return false}});
   const results=await Promise.all(batch.map(async url=>{
    if(!await robotsAllowed(url+'/'))return {url,status:'robots'};
    let r=await fetchUrl(url);
    if(r.redirect){const next=safeUrl(r.redirect,url,city,uf);if(next)r=await fetchUrl(next);}
    return {url,...r};
   }));
   for(const r of results){
    attempts.push({url:r.url,status:r.status,reason:r.reason||''});
    if(!origin&&r.html&&/c[aâ]mara|legislativo|legislativa/i.test(cheerio.load(r.html)('title,body').text().slice(0,2500))){origin=new URL(r.url).origin;homeHtml=r.html;}
   }
   if(origin)break;
  }
  if(!origin)return NextResponse.json({city,uf,attempts,pagesVisited:0,contacts:[],warnings:['Nenhum domínio oficial validado. Habilite SERPER_API_KEY ou cadastre a URL oficial.'],elapsedMs:Date.now()-started,complete:false});
  const rootHost=new URL(origin).hostname;
  const saplHost='sapl.'+rootHost.replace(/^www\./,'');
  const queue=[{url:origin+'/',depth:0}];
  for(const path of PATHS)queue.push({url:origin+path,depth:1});
  queue.push({url:'https://'+saplHost+'/parlamentar/',depth:1});
  const siblingSapl='https://'+rootHost.replace(/^www\./,'').replace(/^camara/,'sapl');
  // The SAPL is a separate official subdomain; it is in scope only with municipal host validation.
  const api=fast?{records:[],links:[],attempt:null}:await saplApi(saplHost,city,uf,deadline);
  if(api.attempt)attempts.push(api.attempt);
  allRecords.push(...api.records);
  for(const url of api.links)queue.unshift({url,depth:1});
  let truncated=false;
  while(queue.length&&pageCount<(fast?12:MAX_PAGES)&&Date.now()<deadline-2500){
   const work=[];
   while(queue.length&&work.length<3){
    const entry=queue.shift();
    const valid=safeUrl(entry.url,origin,city,uf);
    if(!valid||visited.has(valid)||entry.depth>4)continue;
    visited.add(valid);work.push({url:valid,depth:entry.depth});
   }
   if(!work.length)continue;
   const data=await Promise.all(work.map(async e=>{
    if(!await robotsAllowed(e.url))return {...e,status:'robots'};
    if(e.url===origin+'/'&&homeHtml)return {...e,status:200,html:homeHtml};
    const result=await fetchUrl(e.url);
    return {...e,...result};
   }));
   for(const page of data){
    if(page.status!==200||!page.html){attempts.push({url:page.url,status:page.status,reason:page.reason||''});continue;}
    pageCount++;
    allRecords.push(...recordsFromHtml(page.html,page.url,city));
    const links=getLinks(page.html,page.url,city,uf);
    if(page.depth<4)for(const link of links.slice(0,100))queue.push({url:link,depth:page.depth+1});
    // SAPL may have an Angular index without rendered rows; profile URLs can be obtained from API above.
   }
  }
  truncated=queue.length>0;
  return NextResponse.json({city,uf,officialSite:origin,pagesVisited:pageCount,attempts,contacts:mergeContacts(allRecords),elapsedMs:Date.now()-started,complete:!truncated,warnings:truncated?['Limite de tempo/páginas atingido. Execute o worker dedicado para uma varredura completa.']:[]});
 }catch(e){return NextResponse.json({error:'Erro na coleta: '+e.message},{status:500});}
}