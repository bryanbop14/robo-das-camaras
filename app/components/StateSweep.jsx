'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import ContactTable from './ContactTable';
import AssistedCapture, { mergeManual } from './AssistedCapture';
import { uniqUrls } from './CityScan';
import { SECTOR_LABEL } from '../../lib/text.js';
import { CONTACT_HEADER, contactRow, download, formatDuration, hintFor, RETRY_STATUSES, runScan, STATUS_LABEL, STATUS_TONE, toCsv } from '../lib/client.js';

const STORE_VERSION = 4;
const key = uf => 'riole-camaras-sweep-v' + STORE_VERSION + '-' + uf;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function load(uf) { try { const d = JSON.parse(localStorage.getItem(key(uf)) || 'null'); return d?.version === STORE_VERSION ? d : null; } catch { return null; } }
function save(uf, data) { try { localStorage.setItem(key(uf), JSON.stringify(data)); return true; } catch { return false; } }

function report(city, data) {
  return {
    id: city.id, city: city.nome, status: data.status || 'erro',
    contacts: (data.contacts || []).map(c => ({ ...c, city: city.nome })),
    officialSite: data.officialSite || '', saplUrl: data.saplUrl || '', platform: data.platform || '',
    registry: data.registry || null, pagesVisited: data.pagesVisited || 0,
    warning: (data.warnings || []).join(' '), elapsedMs: data.elapsedMs || 0,
    attempts: (data.attempts || []).slice(0, 12), finishedAt: new Date().toISOString(),
    robotsText: (data.robotsText || '').slice(0, 800), blockedUrls: (data.blockedUrls || []).slice(0, 4),
  };
}
const best = r => r.contacts.find(c => c.priority >= 4 && (c.name || c.email)) || r.contacts[0] || null;

export default function StateSweep({ uf, cities, citiesLoading, registry }) {
  const [snap, setSnap] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [notice, setNotice] = useState('');
  const [parallel, setParallel] = useState(3);
  const [statusFilter, setStatusFilter] = useState('todos');
  const [view, setView] = useState('camaras');
  const [open, setOpen] = useState(null);
  const state = useRef(null), run = useRef(0), ctrls = useRef(new Set());

  const stopAll = () => { run.current++; ctrls.current.forEach(c => c.abort()); ctrls.current.clear(); };
  useEffect(() => {
    stopAll();
    const saved = load(uf);
    state.current = saved; setSnap(saved); setPhase(saved ? 'paused' : 'idle'); setNotice(''); setOpen(null); setStatusFilter('todos');
    return stopAll;
  }, [uf]);

  const total = snap?.cities?.length || cities.length || 0;
  const results = useMemo(() => Object.values(snap?.results || {}), [snap]);
  const done = results.length;
  const counts = useMemo(() => results.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}), [results]);
  const allContacts = useMemo(() => results.flatMap(r => r.contacts), [results]);
  const sites = results.filter(r => r.officialSite || r.saplUrl).length;
  const withDecisor = results.filter(r => r.contacts.some(c => c.sector === 'decisor' && c.name)).length;
  const review = results.filter(r => RETRY_STATUSES.has(r.status)).length;
  const priority = allContacts.filter(c => c.priority >= 4).length;
  const percent = total ? Math.round(100 * done / total) : 0;
  const recent = results.slice(-25);
  const avg = recent.length ? recent.reduce((s, r) => s + (r.elapsedMs || 0), 0) / recent.length : 0;
  const eta = phase === 'running' ? (total - done) * (avg + 400) / parallel : 0;
  const tableRows = useMemo(() => results.filter(r => statusFilter === 'todos' || r.status === statusFilter).sort((a, b) => a.city.localeCompare(b.city, 'pt-BR')), [results, statusFilter]);

  function commit(next) {
    state.current = next;
    setSnap({ ...next });
    if (!save(uf, next)) setNotice('O armazenamento do navegador está cheio: exporte os CSVs. O progresso pode não sobreviver ao fechamento da aba.');
  }
  function pause() { stopAll(); setPhase('paused'); }
  function reset() {
    if (!window.confirm('Apagar a varredura salva deste estado? CSVs já exportados não são afetados.')) return;
    stopAll(); try { localStorage.removeItem(key(uf)); } catch {}
    state.current = null; setSnap(null); setPhase('idle'); setNotice('');
  }

  async function start(retryPending = false) {
    if (citiesLoading || !cities.length) return;
    const base = state.current || { version: STORE_VERSION, uf, cities: cities.map(c => ({ id: c.id, nome: c.nome })), results: {}, startedAt: new Date().toISOString() };
    if (retryPending) {
      const kept = Object.fromEntries(Object.entries(base.results).filter(([, r]) => !RETRY_STATUSES.has(r.status) || r.manual));
      commit({ ...base, results: kept });
    } else commit(base);
    setNotice(''); setPhase('running');
    const id = ++run.current;
    const queue = state.current.cities.filter(c => !state.current.results[c.id]);
    let cursor = 0;
    const worker = async () => {
      while (id === run.current) {
        const city = queue[cursor++];
        if (!city) break;
        const hint = hintFor(registry.entries, city.nome);
        let res = null, lastError = '';
        for (let attempt = 0; attempt < 2 && id === run.current && !res; attempt++) {
          const c = new AbortController(); ctrls.current.add(c);
          try { res = await runScan({ uf, city: city.nome, hint, fast: true, signal: c.signal }); }
          catch (e) { lastError = e.message; if (e.name === 'AbortError') break; await sleep(1500); }
          finally { ctrls.current.delete(c); }
        }
        if (id !== run.current) break;
        const rep = res ? report(city, res) : { ...report(city, { status: 'erro', registry: hint ? { email: hint.email, phone: hint.phone, cnpj: hint.cnpj } : null }), error: lastError };
        commit({ ...state.current, results: { ...state.current.results, [city.id]: rep } });
        await sleep(300);
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, Math.max(1, queue.length)) }, worker));
    if (id === run.current) { setPhase('finished'); setNotice('Varredura finalizada. Os municípios em "Exigem revisão" podem ser reprocessados.'); }
  }

  function addManual(id, added) {
    const cur = state.current.results[id];
    const contacts = mergeManual(cur.contacts, added.map(c => ({ ...c, city: cur.city })));
    commit({ ...state.current, results: { ...state.current.results, [id]: { ...cur, contacts, manual: true } } });
  }
  function exportContacts() {
    const rows = [CONTACT_HEADER];
    for (const r of results) for (const c of r.contacts) rows.push(contactRow(uf, r.city, c, SECTOR_LABEL));
    download(toCsv(rows), `contatos-camaras-${uf.toLowerCase()}.csv`);
  }
  function exportChambers() {
    const rows = [['UF', 'Município', 'Situação', 'CNPJ', 'Endereço', 'E-mail (cadastro)', 'Telefone (cadastro)', 'Site', 'SAPL', 'Plataforma', 'Contatos', 'Prioritários', 'Melhor contato', 'Cargo', 'E-mail do contato', 'Telefone do contato']];
    for (const r of [...results].sort((a, b) => a.city.localeCompare(b.city, 'pt-BR'))) {
      const b = best(r), reg = r.registry || {};
      rows.push([uf, r.city, STATUS_LABEL[r.status] || r.status, reg.cnpj, reg.address, reg.email, reg.phone, r.officialSite, r.saplUrl, r.platform,
        r.contacts.length, r.contacts.filter(c => c.priority >= 4).length, b?.name, b?.role, b?.email, b?.phone]);
    }
    download(toCsv(rows), `camaras-${uf.toLowerCase()}.csv`);
  }
  function exportAudit() {
    const rows = [['UF', 'Município', 'Situação', 'Site', 'SAPL', 'Contatos', 'Páginas', 'Duração (ms)', 'Observação', 'Erro', 'Tentativas', 'Data']];
    for (const r of results) rows.push([uf, r.city, r.status, r.officialSite, r.saplUrl, r.contacts.length, r.pagesVisited, r.elapsedMs, r.warning, r.error || '',
      r.attempts.map(a => `${a.url} [${a.status}]`).join(' | '), r.finishedAt]);
    download(toCsv(rows), `auditoria-camaras-${uf.toLowerCase()}.csv`);
  }

  const waitingRegistry = registry.status === 'loading';
  return <div>
    <div className="row spaced">
      <div><h2>Varredura do estado</h2>
        <p>Percorre todos os municípios de {uf}, usando o cadastro oficial do Interlegis como ponto de partida. O progresso fica salvo neste navegador; mantenha a aba aberta durante a execução.</p></div>
      <span className="pill">{phase === 'running' ? 'Em execução' : phase === 'paused' ? 'Pausada' : phase === 'finished' ? 'Finalizada' : 'Pronta'}</span>
    </div>

    <div className="grid metrics six">
      <div><label>Processados</label><div className="count">{done}<span className="muted small"> / {total}</span></div></div>
      <div><label>Sites/SAPL validados</label><div className="count">{sites}</div></div>
      <div><label>Contatos</label><div className="count">{allContacts.length}</div></div>
      <div><label>Prioritários</label><div className="count">{priority}</div></div>
      <div><label>Câmaras com decisor nomeado</label><div className="count">{withDecisor}</div></div>
      <div><label>Exigem revisão</label><div className="count">{review}</div></div>
    </div>
    <div className="progressInfo"><strong>{percent}% concluído</strong>
      <span>{phase === 'running' ? `${parallel} em paralelo · previsão: ${formatDuration(eta)}` : waitingRegistry ? `Carregando cadastro oficial (${registry.loaded}/${registry.pages || '?'} páginas)…` : 'Resultados salvos neste navegador'}</span></div>
    <div className="progressTrack" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total || 1} aria-label="Municípios processados"><div style={{ width: percent + '%' }} /></div>

    <div className="row" style={{ marginTop: 18 }}>
      {phase !== 'running'
        ? <button disabled={citiesLoading || !cities.length || waitingRegistry || (done === total && done > 0)} onClick={() => start(false)}>{done === total && done > 0 ? 'Varredura completa' : done ? 'Retomar varredura' : 'Iniciar varredura'}</button>
        : <button onClick={pause}>Pausar</button>}
      <button className="secondaryBtn" disabled={phase === 'running' || !review} onClick={() => start(true)}>Reprocessar pendentes ({review})</button>
      <label className="inline">Paralelo
        <select value={parallel} disabled={phase === 'running'} onChange={e => setParallel(Number(e.target.value))}>{[1, 2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></label>
      <span className="grow" />
      <button className="secondaryBtn" disabled={!done} onClick={exportContacts}>Contatos CSV</button>
      <button className="secondaryBtn" disabled={!done} onClick={exportChambers}>Câmaras CSV</button>
      <button className="secondaryBtn" disabled={!done} onClick={exportAudit}>Auditoria CSV</button>
      <button className="secondaryBtn" disabled={!snap} onClick={reset}>Reiniciar</button>
    </div>
    {notice && <p role="status" className={notice.includes('cheio') ? 'error' : 'success'}>{notice}</p>}
    {waitingRegistry && <p className="muted small">A varredura começa quando o cadastro oficial terminar de carregar — ele evita testar domínios às cegas.</p>}

    {done > 0 && <>
      <div className="tabs">
        <button className={view === 'camaras' ? 'tab on' : 'tab'} onClick={() => setView('camaras')}>Câmaras</button>
        <button className={view === 'contatos' ? 'tab on' : 'tab'} onClick={() => setView('contatos')}>Todos os contatos</button>
      </div>
      {view === 'camaras' ? <>
        <div className="chips">
          <button className={statusFilter === 'todos' ? 'chip on' : 'chip'} onClick={() => setStatusFilter('todos')}>Todos ({done})</button>
          {Object.entries(STATUS_LABEL).filter(([k]) => counts[k]).map(([k, l]) =>
            <button key={k} className={(statusFilter === k ? 'chip on ' : 'chip ') + 'tone-' + STATUS_TONE[k]} onClick={() => setStatusFilter(k)}>{l} ({counts[k]})</button>)}
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Município</th><th>Situação</th><th>Contatos</th><th>Melhor contato</th><th>Site / SAPL</th></tr></thead>
          <tbody>{tableRows.map(r => { const b = best(r); return <Fragment key={r.id}>
            <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <td><span className="caret">{open === r.id ? '▾' : '▸'}</span> {r.city}</td>
              <td><span className={'tone-' + (STATUS_TONE[r.status] || 'warn')}>{STATUS_LABEL[r.status] || r.status}</span></td>
              <td>{r.contacts.length}{r.contacts.some(c => c.priority >= 4) && <span className="muted small"> · {r.contacts.filter(c => c.priority >= 4).length} prior.</span>}</td>
              <td>{b ? <>{b.name || b.role}<div className="muted small">{b.email || b.phone}</div></> : '—'}</td>
              <td onClick={e => e.stopPropagation()}>{r.officialSite ? <a href={r.officialSite} target="_blank" rel="noreferrer">site</a> : '—'}{r.saplUrl && <> · <a href={r.saplUrl} target="_blank" rel="noreferrer">SAPL</a></>}</td>
            </tr>
            {open === r.id && <tr className="detail"><td colSpan={5}>
              {(r.warning || r.error) && <p className="warn">{r.error || r.warning}</p>}
              {r.platform && <p className="muted small">Plataforma: {r.platform} · {r.pagesVisited} páginas em {(r.elapsedMs / 1000).toFixed(1)} s</p>}
              <ContactTable contacts={r.contacts} />
              {RETRY_STATUSES.has(r.status) && <AssistedCapture urls={uniqUrls(r)} robotsText={r.robotsText}
                onAdd={added => addManual(r.id, added)} />}
            </td></tr>}
          </Fragment>; })}</tbody>
        </table></div>
      </> : <ContactTable contacts={allContacts} showCity limit={800} />}
    </>}
    <p className="muted small"><strong>Importante:</strong> “concluído” indica que a coleta do município terminou dentro dos limites, não que todos os servidores foram identificados. Bloqueios, PDFs e páginas que exigem JavaScript ficam marcados para revisão manual.</p>
  </div>;
}
