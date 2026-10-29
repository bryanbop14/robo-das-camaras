// Uso: node scripts/batch-diagnose.mjs PR "Cidade A" "Cidade B" ... [--full] [--out=arquivo.json]
// Roda a varredura (mesmo código da API) em lote, com o cadastro Interlegis como hint, e imprime um diagnóstico por município.
import { writeFileSync } from 'node:fs';
import { scanCamara } from '../lib/crawler.js';
import { fetchRegistryPage } from '../lib/registry.js';
import { matchRegistry } from '../lib/text.js';

const args = process.argv.slice(2);
const uf = args[0];
const full = args.includes('--full');
const out = (args.find(a => a.startsWith('--out=')) || '').slice(6);
const cities = args.slice(1).filter(a => !a.startsWith('--'));

const first = await fetchRegistryPage(uf, 1);
const entries = [...first.entries];
const pages = [];
for (let p = 2; p <= (first.lastPage || 1); p++) pages.push(p);
for (let i = 0; i < pages.length; i += 4) (await Promise.all(pages.slice(i, i + 4).map(p => fetchRegistryPage(uf, p)))).forEach(r => entries.push(...r.entries));
console.error(`cadastro ${uf}: ${entries.length} entradas`);

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < cities.length) {
    const city = cities[cursor++];
    const hint = matchRegistry(entries, city);
    const t = Date.now();
    try {
      const r = await scanCamara(city, uf, { fast: !full, hint: hint ? { ...hint, registrySource: 'https://www12.senado.leg.br/interlegis/orgaosatendidos?uf=' + uf } : null });
      const named = r.contacts.filter(c => c.name).length;
      results.push({ city, status: r.status, site: r.officialSite, platform: r.platform, discovery: r.discovery, pages: r.pagesVisited, contacts: r.contacts.length, named, ms: Date.now() - t, hintSite: hint?.site || '', hintEmail: hint?.email || '', attempts: r.attempts, warnings: r.warnings, sample: r.contacts.slice(0, 4).map(c => `${c.name || '-'} | ${c.role} | ${c.email}`) });
      console.error(`${city.padEnd(26)} ${r.status.padEnd(18)} ${String(r.contacts.length).padStart(3)} (${named} nomes) ${r.officialSite || '-'} [${r.platform || ''}] ${Date.now() - t}ms`);
    } catch (e) {
      results.push({ city, status: 'exception', error: e.message });
      console.error(city, 'EXCEPTION', e.message);
    }
  }
}
const par = Number((args.find(a => a.startsWith("--par=")) || "--par=3").slice(6));
await Promise.all(Array.from({ length: par }, worker));
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
