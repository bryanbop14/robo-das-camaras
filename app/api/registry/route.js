import { NextResponse } from 'next/server';
import { fetchRegistryPage, REGISTRY_BASE } from '../../../lib/registry.js';
import { UF_SET } from '../../../lib/text.js';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const preferredRegion = ['gru1', 'iad1'];
const MAX_BATCH = 8;
const CONCURRENCY = 3;

/** GET /api/registry?uf=PR&from=1&to=6 — lê um lote de páginas do cadastro Interlegis com concorrência controlada. */
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const uf = String(params.get('uf') || '').toUpperCase();
  const from = Math.max(1, Number(params.get('from')) || 1);
  const to = Math.min(from + MAX_BATCH - 1, Math.max(from, Number(params.get('to')) || from));
  const force = params.get('refresh') === '1';
  if (!UF_SET.has(uf)) return NextResponse.json({ error: 'UF inválida' }, { status: 400 });

  const pages = [];
  for (let p = from; p <= to; p++) pages.push(p);

  const results = new Array(pages.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < pages.length) {
      const idx = cursor++;
      const p = pages[idx];
      let r = await fetchRegistryPage(uf, p, { force }).catch(e => ({ page: p, status: 'erro', entries: [], reason: e.message }));
      if (r.status !== 200) {
        await new Promise(res => setTimeout(res, 350));
        r = await fetchRegistryPage(uf, p, { force: true }).catch(e => ({ page: p, status: 'erro', entries: [], reason: e.message }));
      }
      results[idx] = r;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker()));

  const lastPage = Math.max(0, ...results.map(r => r.lastPage || 0)) || null;
  const entries = results.flatMap(r => r.entries);
  const allOk = results.every(r => r.status === 200) && (entries.length > 0 || from > 1);
  const cacheControl = (allOk && !force)
    ? 'public, s-maxage=21600, stale-while-revalidate=86400'
    : 'no-store, max-age=0';

  return NextResponse.json({
    uf, from, to, lastPage, source: REGISTRY_BASE + '?uf=' + uf,
    pages: results.map(r => ({ page: r.page, status: r.status, count: r.entries.length })),
    entries,
  }, { headers: { 'cache-control': cacheControl } });
}
