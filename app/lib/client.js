'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { matchRegistry } from '../../lib/text.js';

export const STATUS_LABEL = {
  concluido: 'Concluído',
  parcial: 'Parcial',
  bloqueado: 'Bloqueado pelo site',
  inacessivel: 'Site inacessível',
  fonte_alternativa: 'Só cadastro oficial',
  site_nao_validado: 'Site não validado',
  sem_site: 'Sem site localizado',
  erro: 'Erro',
};
export const STATUS_TONE = { concluido: 'ok', parcial: 'warn', fonte_alternativa: 'warn', site_nao_validado: 'bad', bloqueado: 'bad', inacessivel: 'bad', sem_site: 'bad', erro: 'bad' };
export const RETRY_STATUSES = new Set(['parcial', 'fonte_alternativa', 'site_nao_validado', 'bloqueado', 'inacessivel', 'sem_site', 'erro']);
export const PRIORITY_SECTORS = new Set(['decisor', 'compras', 'ti', 'comunicacao']);

function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }

const REGISTRY_TTL = 7 * 24 * 60 * 60 * 1000;
const REGISTRY_KEY = uf => 'riole-registry-v2-' + uf;

/** Carrega o cadastro Interlegis do estado (em lotes paralelos controlados) e o guarda por 7 dias no navegador. */
export function useRegistry(uf) {
  const [state, setState] = useState({ status: 'idle', entries: [], pages: 0, loaded: 0, failed: 0, updatedAt: null });
  const run = useRef(0);
  const load = useCallback(async (force = false) => {
    const id = ++run.current;
    const cached = !force && readJson(REGISTRY_KEY(uf));
    if (cached && Date.now() - cached.time < REGISTRY_TTL && cached.entries?.length && !cached.failed) {
      setState({ status: 'ready', entries: cached.entries, pages: cached.pages, loaded: cached.pages, failed: 0, updatedAt: cached.time });
      return;
    }
    setState({ status: 'loading', entries: [], pages: 0, loaded: 0, failed: 0, updatedAt: null });
    const all = [];
    const failedPages = new Set();
    const fetchBatch = async (from, to, bypassCache = force) => {
      const qs = `uf=${uf}&from=${from}&to=${to}&v=2` + (bypassCache ? `&refresh=1&t=${Date.now()}` : '');
      const r = await fetch(`/api/registry?${qs}`, bypassCache ? { cache: 'no-store' } : undefined);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    };
    try {
      let first = await fetchBatch(1, 4, force);
      if (!first.entries?.length && !force) {
        first = await fetchBatch(1, 4, true);
      }
      if (id !== run.current) return;
      const last = Math.max(first.lastPage || 1, 1);
      all.push(...(first.entries || []));
      for (const p of (first.pages || [])) if (p.status !== 200) failedPages.add(p.page);
      let loaded = Math.min(4, last);
      setState(s => ({ ...s, pages: last, loaded, entries: [...all] }));
      const batches = [];
      for (let p = 5; p <= last; p += 6) batches.push([p, Math.min(p + 5, last)]);
      let cursor = 0;
      const worker = async () => {
        while (cursor < batches.length && id === run.current) {
          const [from, to] = batches[cursor++];
          try {
            const r = await fetchBatch(from, to, force);
            all.push(...(r.entries || []));
            for (const p of (r.pages || [])) if (p.status !== 200) failedPages.add(p.page);
          } catch {
            for (let p = from; p <= to; p++) failedPages.add(p);
          }
          loaded += to - from + 1;
          if (id === run.current) setState(s => ({ ...s, loaded, entries: [...all] }));
        }
      };
      await Promise.all([worker(), worker()]);
      if (id !== run.current) return;

      // Retenta individualmente páginas que tenham falhado por oscilação do Senado
      if (failedPages.size > 0 && failedPages.size <= 12) {
        for (const pageNum of [...failedPages]) {
          if (id !== run.current) return;
          try {
            const retry = await fetchBatch(pageNum, pageNum, true);
            if (retry.pages?.[0]?.status === 200) {
              all.push(...(retry.entries || []));
              failedPages.delete(pageNum);
            }
          } catch {}
        }
      }

      const failed = failedPages.size;
      const dedup = [...new Map(all.map(e => [e.cnpj || e.cityKey, e])).values()];
      const time = Date.now();
      if (dedup.length) writeJson(REGISTRY_KEY(uf), { time, entries: dedup, pages: last, failed });
      setState({ status: dedup.length ? 'ready' : 'error', entries: dedup, pages: last, loaded: last, failed, updatedAt: time });
    } catch (e) {
      if (id === run.current) setState(s => ({ ...s, status: 'error', error: e.message }));
    }
  }, [uf]);
  useEffect(() => { load(false); return () => { run.current++; }; }, [load]);
  return { ...state, reload: () => load(true) };
}

export function useCities(uf) {
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const key = 'riole-ibge-v1-' + uf;
    const cached = readJson(key);
    if (cached?.length) { setCities(cached); setError(''); return; }
    setLoading(true); setError('');
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`)
      .then(r => r.json())
      .then(d => { if (!active) return; const list = d.map(c => ({ id: c.id, nome: c.nome })); setCities(list); writeJson(key, list); })
      .catch(() => active && setError('Não foi possível carregar os municípios do IBGE.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [uf]);
  return { cities, loading, error };
}

export function hintFor(entries, city) {
  const e = matchRegistry(entries, city);
  return e ? { ...e, registrySource: 'https://www12.senado.leg.br/interlegis/orgaosatendidos?uf=' + e.uf } : null;
}

export async function runScan({ uf, city, hint, fast, signal }) {
  const response = await fetch('/api/scan', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uf, city, fast, hint }),
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || !data || data.error) throw new Error(data?.error || 'HTTP ' + response.status);
  return data;
}

export function toCsv(rows) {
  return '﻿' + rows.map(row => row.map(v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmula ao abrir no Excel
    return '"' + s.replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n');
}

export function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const CONTACT_HEADER = ['UF', 'Município', 'Nome', 'Cargo', 'Setor', 'Prioridade', 'E-mail', 'Tipo de e-mail', 'Telefone', 'Confiança', 'Nível', 'Origem', 'Fonte', 'Endereço da Câmara', 'CEP', 'Status de validação', 'Evidência', 'Domínio oficial', 'Município da fonte', 'E-mail compartilhado (Câmara)', 'Compartilhado com', 'Coletado em', 'Execução'];
export function contactRow(uf, city, c, sectorLabel, address) {
  return [uf, city, c.name, c.role, sectorLabel[c.sector || ''] || '', c.priority, c.email, c.emailKind, c.phone, c.confidence, c.confidenceLabel, c.type, c.source, address?.text || '', address?.cep || '',
    c.validation || 'NAO_VERIFICADO', [c.evidence, c.validationReason, c.crossReason].filter(Boolean).join(' | '), c.officialDomain || '', c.sourceCity || '',
    c.sharedEmail || '', (c.sharedAcross || []).join(', '), c.collectedAt || '', c.runId || ''];
}

/** Endereço em uma linha: "Rua X, 123 - Centro · CEP 00000-000". */
export function formatAddress(a) {
  if (!a?.text) return '';
  return a.text + (a.cep && !a.text.replace(/\D/g, '').includes(a.cep.replace(/\D/g, '')) ? ' · CEP ' + a.cep : '');
}

export function formatDuration(ms) {
  if (!isFinite(ms) || ms <= 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
