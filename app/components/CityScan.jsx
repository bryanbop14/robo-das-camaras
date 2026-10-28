'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import ContactTable from './ContactTable';
import AssistedCapture, { mergeManual } from './AssistedCapture';
import { SECTOR_LABEL } from '../../lib/text.js';
import { CONTACT_HEADER, contactRow, download, hintFor, runScan, STATUS_LABEL, STATUS_TONE, toCsv } from '../lib/client.js';

export function uniqUrls(r) {
  const list = [r.officialSite, ...(r.blockedUrls || [])].filter(Boolean).map(u => { try { return new URL(u).origin; } catch { return ''; } }).filter(Boolean);
  return [...new Set(list)];
}

export default function CityScan({ uf, cities, citiesLoading, registry }) {
  const [city, setCity] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const ctrl = useRef(null);

  useEffect(() => { setCity(cities[0]?.nome || ''); setResult(null); setError(''); }, [cities]);
  const hint = useMemo(() => hintFor(registry.entries, city), [registry.entries, city]);

  async function scan() {
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    setRunning(true); setError(''); setResult(null);
    try { setResult(await runScan({ uf, city, hint, fast: false, signal: c.signal })); }
    catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    finally { setRunning(false); }
  }
  function csv() {
    const rows = [CONTACT_HEADER, ...result.contacts.map(c => contactRow(uf, city, c, SECTOR_LABEL))];
    download(toCsv(rows), 'contatos-' + city.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-') + '-' + uf.toLowerCase() + '.csv');
  }
  const priority = result?.contacts.filter(c => c.priority >= 4).length || 0;

  return <>
    <div className="grid">
      <div><label>Município</label>
        <select value={city} onChange={e => { setCity(e.target.value); setResult(null); }} disabled={citiesLoading}>
          {cities.map(x => <option key={x.id}>{x.nome}</option>)}
        </select></div>
      <div className="alignEnd"><button onClick={scan} disabled={running || !city}>{running ? 'Consultando fontes…' : 'Pesquisar Câmara'}</button></div>
    </div>

    {city && <div className="registryCard">
      {hint ? <>
        <div className="muted small">Cadastro oficial Interlegis</div>
        <strong>{hint.name}</strong>
        <div className="kv">
          {hint.cnpj && <span>CNPJ {hint.cnpj}</span>}
          {hint.email && <span>{hint.email}</span>}
          {hint.phone && <span>{hint.phone}</span>}
          {hint.site && <a href={hint.site} target="_blank" rel="noreferrer">site</a>}
          {hint.sapl && <a href={hint.sapl} target="_blank" rel="noreferrer">SAPL</a>}
        </div>
        {hint.address && <div className="muted small">{hint.address}{hint.cep ? ' · CEP ' + hint.cep : ''}</div>}
      </> : <span className="muted small">{registry.status === 'loading' ? 'Carregando cadastro oficial do estado…' : 'Município sem registro no cadastro Interlegis: a descoberta usará padrões de domínio e busca.'}</span>}
    </div>}

    {error && <p className="error">{error}</p>}

    {result && <>
      <div className="grid metrics">
        <div><label>Situação</label><div className={'count tone-' + (STATUS_TONE[result.status] || 'warn')} style={{ fontSize: 20 }}>{STATUS_LABEL[result.status] || result.status}</div></div>
        <div><label>Contatos</label><div className="count">{result.contacts.length}</div></div>
        <div><label>Prioritários</label><div className="count">{priority}</div></div>
        <div><label>Páginas lidas</label><div className="count">{result.pagesVisited} <span className="muted small">em {(result.elapsedMs / 1000).toFixed(1)} s</span></div></div>
      </div>
      <div className="kv">
        {result.officialSite && <span>Site: <a href={result.officialSite} target="_blank" rel="noreferrer">{result.officialSite}</a></span>}
        {result.saplUrl && <span>SAPL: <a href={result.saplUrl} target="_blank" rel="noreferrer">{result.saplUrl}</a></span>}
        {result.platform && <span>Plataforma: {result.platform}</span>}
      </div>
      {result.warnings?.map((w, i) => <p key={i} className="warn">{w}</p>)}
      {['bloqueado', 'inacessivel', 'sem_site', 'parcial', 'fonte_alternativa'].includes(result.status) && <AssistedCapture
        key={result.city + result.elapsedMs}
        urls={uniqUrls(result)}
        robotsText={result.robotsText}
        officialHost={hint?.site ? new URL(hint.site).hostname : ''}
        onAdd={added => setResult(r => ({ ...r, contacts: mergeManual(r.contacts, added) }))} />}
      <div className="row spaced"><h2>Contatos institucionais</h2><button onClick={csv} disabled={!result.contacts.length}>Exportar CSV</button></div>
      <ContactTable contacts={result.contacts} />
      <details className="audit"><summary>Auditoria da coleta ({result.attempts.length} registros)</summary>
        <div className="tablewrap"><table><thead><tr><th>Endereço</th><th>Situação</th><th>Observação</th></tr></thead>
          <tbody>{result.attempts.map((a, i) => <tr key={i}><td>{/^https?:/.test(a.url) ? <a href={a.url} target="_blank" rel="noreferrer">{a.url}</a> : a.url}</td><td>{String(a.status)}</td><td>{a.reason || '—'}</td></tr>)}</tbody></table></div>
      </details>
    </>}
  </>;
}
