import * as cheerio from 'cheerio';

const CACHE_TTL_MS=20*60*1000;
const cache=new Map();
const TIMEOUT_MS=6500;
const EMAIL=/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const PHONE=/(?:\+55[\s-]*)?\(?\d{2}\)?[\s-]*\d{4,5}[-.\s]?\d{4}/g;
const UF_SET=new Set('AC AL AP AM BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '));

function normalize(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function lines(html){
  const $=cheerio.load(html);
  $('script,style,footer,nav,header,svg').remove();
  $('br').replaceWith('\n');
  $('tr,td,p,h1,h2,h3,h4,dt,dd,li,article,section').each((_,el)=>$(el).append('\n'));
  return $('body').text().split(/\r?\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
}
async function officialPage(url){
  const cached=cache.get(url);
  if(cached&&Date.now()-cached.time<CACHE_TTL_MS)return cached.data;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{
    const response=await fetch(url,{headers:{'user-agent':'RiolePublicContactResearch/0.4 (public authorities)'},signal:controller.signal,cache:'no-store'});
    if(!response.ok)return {status:response.status,html:''};
    const type=response.headers.get('content-type')||'';
    if(!type.includes('text/html'))return {status:'não_html',html:''};
    const html=(await response.text()).slice(0,8000000);
    const data={status:response.status,html};
    cache.set(url,{time:Date.now(),data});
    if(cache.size>5)cache.delete(cache.keys().next().value);
    return data;
  }catch(error){return {status:error.name==='AbortError'?'timeout':'falha_rede',html:''};}
  finally{clearTimeout(timeout);}
}
function unique(items){return [...new Set(items.filter(Boolean))];}
function nextInstitution(line){
  return /^CÂMARA MUNICIPAL DE /i.test(line)||/^PRESIDENTE(?: INTERINO)? DA CÂMARA MUNICIPAL DE /i.test(line);
}
function findSenate(linesArray,city,source){
  const target=normalize('Câmara Municipal de '+city);
  const contacts=[];
  for(let i=0;i<linesArray.length;i++){
    if(normalize(linesArray[i])!==target)continue;
    const block=[];
    for(let j=i+1;j<Math.min(linesArray.length,i+38);j++){
      if(nextInstitution(linesArray[j])&&normalize(linesArray[j])!==target)break;
      block.push(linesArray[j]);
      if(block.join(' ').length>1400)break;
    }
    const text=block.join(' ');
    const email=(text.match(EMAIL)||[])[0]||'';
    const phone=(text.match(PHONE)||[])[0]||'';
    if(email||phone)contacts.push({name:'',role:'Contato institucional (cadastro Interlegis)',email,phone,source,type:'interlegis'});
    // A single municipality can appear in the document more than once, but its institutional record is enough.
    if(contacts.length)break;
  }
  return contacts;
}
function findGcau(linesArray,city,source){
  const target=normalize('PRESIDENTE DA CÂMARA MUNICIPAL DE '+city);
  const targetInterino=normalize('PRESIDENTE INTERINO DA CÂMARA MUNICIPAL DE '+city);
  for(let i=0;i<linesArray.length;i++){
    if(![target,targetInterino].includes(normalize(linesArray[i])))continue;
    // The previous section of the register ends at its e-mail; the last uppercase person name is nearest the role.
    const preceding=linesArray.slice(Math.max(0,i-7),i);
    const name=preceding.reverse().find(line=>{
      const words=line.trim().split(/\s+/);
      return words.length>=2&&words.length<=9&&line.length<=95&&
       /^[A-ZÀ-ÝÇÃÕÂÊÔÍÚÉÓÁÜ\s'’-]+$/.test(line)&&
       !/PRESIDENTE|CÂMARA|E-MAIL|TELEFONE|GERAR PDF|LEGISLATIVO|AUTORIDADES/.test(line);
    })||'';
    const info=[];
    for(let j=i+1;j<Math.min(linesArray.length,i+16);j++){
      if(nextInstitution(linesArray[j]))break;
      info.push(linesArray[j]);
    }
    const text=info.join(' ');
    const email=(text.match(EMAIL)||[])[0]||'';
    const phone=unique(text.match(PHONE)||[]).slice(0,2).join(' / ');
    if(name&&(email||phone))return [{name,role:'Presidente da Câmara',email,phone,source,type:'cadastro-autoridades'}];
    if(email||phone)return [{name:'',role:'Presidência da Câmara (cadastro de autoridades)',email,phone,source,type:'cadastro-autoridades'}];
  }
  return [];
}
export async function officialFallback(city,uf){
  if(!UF_SET.has(uf))return {contacts:[],attempts:[]};
  const sources=[
    {id:'interlegis',url:'https://www12.senado.leg.br/interlegis/orgaosatendidos?servico=PM&tipocasa=CM&uf='+uf}
  ];
  if(uf==='PR')sources.push({id:'gcau-pr',url:'https://www.gcau-consulta.casacivil.pr.gov.br/gcau_internet/servicoLivreConsultaAgrupadorInternet.do?action=pesquisarPorAgrupadorInternet&codAgrupadorInternet=131'});
  const results=await Promise.all(sources.map(async source=>{
    const page=await officialPage(source.url);
    const list=page.html?lines(page.html):[];
    const contacts=source.id==='interlegis'?findSenate(list,city,source.url):findGcau(list,city,source.url);
    return {contacts,attempt:{url:source.url,status:page.status,reason:contacts.length?'Cadastro oficial: '+contacts.length+' contato(s) associado(s) ao município':'Cadastro consultado sem contato extraível para este município'}};
  }));
  return {contacts:results.flatMap(x=>x.contacts),attempts:results.map(x=>x.attempt)};
}
