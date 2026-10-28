'use client';
import {useEffect,useMemo,useRef,useState} from 'react';

const STORE_VERSION=2;
const MAX_PARALLEL=2; // Deliberately bounded to avoid overloading public websites.
const pauseBetween=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function key(uf){return 'riole-camaras-sweep-v'+STORE_VERSION+'-'+uf;}
function load(uf){try{const data=JSON.parse(localStorage.getItem(key(uf))||'null');return data?.version===STORE_VERSION?data:null;}catch{return null;}}
function save(uf,data){try{localStorage.setItem(key(uf),JSON.stringify({...data,version:STORE_VERSION,updatedAt:new Date().toISOString()}));return true;}catch{return false;}}
function safeCsv(rows){return '\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\r\n');}
function download(text,name){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function reportFor(city,data){
 const contacts=Array.isArray(data.contacts)?data.contacts:[];
 const attempts=Array.isArray(data.attempts)?data.attempts:[];
 let status='concluido';
 if(!data.officialSite)status=contacts.length?'fonte_alternativa':'site_nao_localizado';
 else if(data.complete===false)status='parcial';
 return {id:city.id,city:city.nome,status,contacts,attempts:attempts.slice(0,35),pagesVisited:data.pagesVisited||0,officialSite:data.officialSite||'',warning:(data.warnings||[]).join('; '),elapsedMs:data.elapsedMs||0,finishedAt:new Date().toISOString()};
}
export default function StateSweep({uf,cities,loadingCities}){
 const [snapshot,setSnapshot]=useState(null),[phase,setPhase]=useState('idle'),[notice,setNotice]=useState('');
 const state=useRef(null),run=useRef(0),controllers=useRef(new Set());
 useEffect(()=>{
  run.current++;
  controllers.current.forEach(c=>c.abort());controllers.current.clear();
  const saved=load(uf);
  state.current=saved||null;
  setSnapshot(saved);setPhase(saved?'paused':'idle');setNotice('');
  return ()=>{run.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();};
 },[uf]);
 const total=snapshot?.cities?.length||cities.length||0;
 const done=Object.keys(snapshot?.results||{}).length;
 const results=Object.values(snapshot?.results||{});
 const found=results.reduce((n,r)=>n+(r.contacts?.length||0),0);
 const ok=results.filter(r=>r.officialSite).length;
 const problems=results.filter(r=>r.status==='erro'||r.status==='site_nao_localizado'||r.status==='parcial').length;
 const percent=total?Math.round(100*done/total):0;
 const last=results.slice(-20).reverse();
 const current=useMemo(()=>results.flatMap(r=>(r.contacts||[]).map(c=>({municipio:r.city,uf,...c}))),[snapshot]);
 function commit(next){state.current=next;setSnapshot({...next});if(!save(uf,next))setNotice('O armazenamento local está cheio: exporte os resultados. O progresso pode não ser recuperável após fechar o navegador.');}
 function pause(){run.current++;controllers.current.forEach(c=>c.abort());controllers.current.clear();setPhase('paused');}
 function reset(){pause();if(typeof window!=='undefined'&&!window.confirm('Apagar a varredura salva deste estado? Os contatos exportados não serão afetados.'))return;localStorage.removeItem(key(uf));state.current=null;setSnapshot(null);setPhase('idle');setNotice('');}
 async function start(){
  if(loadingCities||!cities.length)return;
  const source=state.current?.cities?.length?state.current.cities:cities.map(c=>({id:c.id,nome:c.nome}));
  const original=state.current?.cities?.length===source.length?state.current:null;
  const initial=original||{version:STORE_VERSION,uf,cities:source,results:{},startedAt:new Date().toISOString()};
  commit(initial);setNotice('');setPhase('running');
  const id=++run.current;
  let cursor=0;
  const queue=source.filter(c=>!initial.results[c.id]);
  async function worker(){
   while(id===run.current){
    const city=queue[cursor++];
    if(!city)break;
    const ctrl=new AbortController();controllers.current.add(ctrl);
    try{
      const response=await fetch('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uf,city:city.nome,fast:true}),signal:ctrl.signal});
      if(!response.ok)throw Error('HTTP '+response.status);
      const result=await response.json();
      if(result.error)throw Error(result.error);
      if(id!==run.current)break;
      const latest=state.current;
      commit({...latest,results:{...latest.results,[city.id]:reportFor(city,result)}});
    }catch(e){
      if(id!==run.current)break;
      const latest=state.current;
      commit({...latest,results:{...latest.results,[city.id]:{id:city.id,city:city.nome,status:'erro',error:String(e.message),contacts:[],attempts:[],pagesVisited:0,officialSite:'',finishedAt:new Date().toISOString()}}});
    }finally{controllers.current.delete(ctrl);}
    if(id===run.current)await pauseBetween(450);
   }
  }
  await Promise.all(Array.from({length:Math.min(MAX_PARALLEL,queue.length)},worker));
  if(id===run.current){setPhase('finished');setNotice('Varredura do estado finalizada. Os casos sem site e parciais continuam destacados para revisão.');}
 }
 function csv(){
  const rows=[['UF','Municipio','Nome','Cargo','Email','Telefone','Fonte','Tipo','Status']];
  for(const r of results)for(const c of r.contacts||[])rows.push([uf,r.city,c.name,c.role,c.email,c.phone,c.source,c.type,r.status]);
  download(safeCsv(rows),'contatos-camaras-'+uf.toLowerCase()+'.csv');
 }
 function auditCsv(){
  const rows=[['UF','Municipio','Status','Site oficial','Contatos','Paginas','Duracao (ms)','Observacao','Erro','Data']];
  for(const r of results)rows.push([uf,r.city,r.status,r.officialSite,(r.contacts||[]).length,r.pagesVisited,r.elapsedMs,r.warning||'',r.error||'',r.finishedAt]);
  download(safeCsv(rows),'auditoria-camaras-'+uf.toLowerCase()+'.csv');
 }
 return <div>
  <div className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
    <div><h2>Varredura do estado completo</h2><p>Pesquisa todos os municípios do estado selecionado. O navegador acompanha e salva o progresso de cada município; mantenha esta aba aberta durante a execução.</p></div>
    <span className="pill">{phase==='running'?'Em execução':phase==='paused'?'Pausada':phase==='finished'?'Finalizada':'Pronta'}</span>
  </div>
  <div className="grid metrics" aria-live="polite">
    <div><label>Municípios processados</label><div className="count">{done} <span className="muted" style={{fontSize:15}}>de {total}</span></div></div>
    <div><label>Sites encontrados</label><div className="count">{ok}</div></div>
    <div><label>Contatos encontrados</label><div className="count">{found}</div></div>
    <div><label>Exigem revisão</label><div className="count">{problems}</div></div>
  </div>
  <div className="progressInfo"><strong>{percent}% concluído</strong><span>{phase==='running'?'Pesquisando em paralelo (2 municípios)':'Resultados persistidos neste navegador'}</span></div>
  <div className="progressTrack" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total||1} aria-label="Municípios processados"><div style={{width:percent+'%'}}/></div>
  <div className="row" style={{marginTop:18}}>
    {phase!=='running'?<button disabled={loadingCities||!cities.length||done===total&&done>0} onClick={start}>{done?'Retomar varredura':'Iniciar varredura estadual'}</button>:<button onClick={pause}>Pausar</button>}
    <button className="secondaryBtn" disabled={!done} onClick={csv}>Exportar contatos CSV</button>
    <button className="secondaryBtn" disabled={!done} onClick={auditCsv}>Exportar auditoria CSV</button>
    <button className="secondaryBtn" disabled={!snapshot} onClick={reset}>Reiniciar</button>
  </div>
  {notice&&<p role="status" className={notice.includes('cheio')?'error':'success'}>{notice}</p>}
  <p className="muted"><strong>Importante:</strong> “concluído” significa que a tentativa do município terminou, não que todos os servidores foram identificados. Sites bloqueados, documentos e contatos ausentes permanecem pendentes de revisão. A execução não continua com o navegador fechado.</p>
  {done>0&&<div className="tablewrap"><table><thead><tr><th>Município</th><th>Situação</th><th>Contatos</th><th>Páginas</th><th>Site encontrado</th></tr></thead><tbody>{last.map(r=><tr key={r.id}><td>{r.city}</td><td><span className={r.status==='concluido'?'success':'error'}>{r.status.replaceAll('_',' ')}</span></td><td>{r.contacts?.length||0}</td><td>{r.pagesVisited}</td><td>{r.officialSite?<a href={r.officialSite} target="_blank" rel="noreferrer">{r.officialSite}</a>:'—'}</td></tr>)}</tbody></table></div>}
  {current.length>0&&<p>Última atualização: {new Date(snapshot.updatedAt).toLocaleString('pt-BR')} · {current.length} registros disponíveis para exportação.</p>}
 </div>;
}