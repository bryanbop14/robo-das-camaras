'use client';
import { useState } from 'react';

// Cada site usa caminhos próprios: em vez de chutar URLs (que dão 404), busca as páginas reais dentro do domínio.
const TOPICS = [
  ['Vereadores', 'vereadores'],
  ['Mesa Diretora', '"mesa diretora" presidente'],
  ['Contato', 'contato OR "fale conosco" e-mail'],
  ['Telefones / ramais', 'telefones OR ramais'],
  ['Servidores / setores', 'servidores OR "estrutura organizacional" OR diretoria'],
  ['Licitações', 'licitação pregoeiro'],
];
const siteSearch = (host, q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:' + host + ' ' + q);

/** Junta contatos novos aos existentes, sem duplicar e-mail/telefone. */
export function mergeManual(existing, added) {
  const key = c => c.email ? 'e:' + c.email : 'p:' + c.phone;
  const map = new Map(existing.map(c => [key(c), c]));
  for (const c of added) {
    const cur = map.get(key(c));
    map.set(key(c), cur ? { ...cur, name: cur.name || c.name, phone: cur.phone || c.phone, role: cur.sector === 'institucional' && c.sector !== 'institucional' ? c.role : cur.role, sector: cur.sector === 'institucional' && c.sector !== 'institucional' ? c.sector : cur.sector } : c);
  }
  return [...map.values()].sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.confidence || 0) - (a.confidence || 0));
}

/**
 * Coleta assistida: a pessoa abre a página no próprio navegador (como qualquer cidadão) e cola o conteúdo.
 * Nenhuma requisição automática é feita ao site que recusou robôs.
 */
export default function AssistedCapture({ urls = [], robotsText = '', officialHost = '', onAdd }) {
  const base = (urls[0] || '').replace(/\/$/, '');
  const host = base ? new URL(base).hostname.replace(/^www\./, '') : '';
  const [source, setSource] = useState(base ? base + '/' : '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function extract() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, sourceUrl: source, officialHost }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha');
      onAdd(d.contacts);
      setMsg(d.contacts.length ? `${d.contacts.length} contato(s) extraído(s) e adicionados.` : 'Nenhum e-mail ou telefone encontrado no texto colado.');
      if (d.contacts.length) setText('');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return <div className="assisted">
    <h3>Coleta assistida</h3>
    <p className="muted small">O site recusa leitura automatizada. Abra as páginas no seu navegador, selecione tudo (Ctrl+A / Cmd+A), copie e cole aqui — o robô extrai e classifica os contatos sem acessar o site.</p>
    {base && <div className="row wraplinks">
      <a className="linkbtn" href={base + '/'} target="_blank" rel="noreferrer" onClick={() => setSource(base + '/')}>Início ↗</a>
      {TOPICS.map(([label, q]) => <a key={label} className="linkbtn" href={siteSearch(host, q)} target="_blank" rel="noreferrer">{label} 🔍</a>)}
    </div>}
    {base && <p className="muted small">Os botões com 🔍 abrem uma busca dentro do domínio da Câmara. Depois de abrir a página certa, cole o endereço dela em “Página de origem”.</p>}
    {robotsText && <details><summary className="small">Ver robots.txt do site</summary><pre className="robots">{robotsText}</pre></details>}
    <div className="grid two">
      <div><label>Página de origem</label><input value={source} onChange={e => setSource(e.target.value)} placeholder="https://…" /></div>
    </div>
    <label style={{ marginTop: 10 }}>Conteúdo copiado</label>
    <textarea rows={7} value={text} onChange={e => setText(e.target.value)} placeholder="Cole aqui o texto da página de vereadores, contatos ou estrutura…" />
    <div className="row" style={{ marginTop: 10 }}>
      <button onClick={extract} disabled={busy || text.trim().length < 5}>{busy ? 'Extraindo…' : 'Extrair contatos'}</button>
      {msg && <span className={/extraído/.test(msg) ? 'success' : 'warn'}>{msg}</span>}
    </div>
  </div>;
}
