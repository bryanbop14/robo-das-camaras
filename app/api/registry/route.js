import { NextResponse } from 'next/server';
import { fetchRegistryPage, REGISTRY_BASE } from '../../../lib/registry.js';
import { UF_SET } from '../../../lib/text.js';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_BATCH = 8;

/** GET /api/registry?uf=PR&from=1&to=8 — lê um lote de páginas do cadastro Interlegis em paralelo. */
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const uf = String(params.get('uf') || '').toUpperCase();
  const from = Math.max(1, Number(params.get('from')) || 1);
  const to = Math.min(from + MAX_BATCH - 1, Math.max(from, Number(params.get('to')) || from));
  if (!UF_SET.has(uf)) return NextResponse.json({ error: 'UF inválida' }, { status: 400 });
  const pages = [];
  for (let p = from; p <= to; p++) pages.push(p);
  const results = await Promise.all(pages.map(p => fetchRegistryPage(uf, p).catch(e => ({ page: p, status: 'erro', entries: [], reason: e.message }))));
  const lastPage = Math.max(0, ...results.map(r => r.lastPage || 0)) || null;
  return NextResponse.json({
    uf, from, to, lastPage, source: REGISTRY_BASE + '?uf=' + uf,
    pages: results.map(r => ({ page: r.page, status: r.status, count: r.entries.length })),
    entries: results.flatMap(r => r.entries),
  }, { headers: { 'cache-control': 'public, s-maxage=21600, stale-while-revalidate=86400' } });
}
