// Uso: node scripts/scan-cli.mjs "Cidade" UF [--fast] [--registry]
// Executa a varredura localmente (mesmo código da rota /api/scan) e imprime um resumo.
import { scanCamara } from '../lib/crawler.js';
import { fetchRegistryPage } from '../lib/registry.js';
import { matchRegistry } from '../lib/text.js';

const [city, uf = 'PR', ...flags] = process.argv.slice(2);
const fast = flags.includes('--fast');
let hint = null;
if (flags.includes('--registry')) {
  const first = await fetchRegistryPage(uf, 1);
  const all = [...first.entries];
  for (let p = 2; p <= (first.lastPage || 1); p++) all.push(...(await fetchRegistryPage(uf, p)).entries);
  hint = matchRegistry(all, city);
  console.log('hint:', hint ? { site: hint.site, sapl: hint.sapl, email: hint.email, services: hint.services } : null);
}
const r = await scanCamara(city, uf, { fast, hint });
console.log({ status: r.status, site: r.officialSite, platform: r.platform, pages: r.pagesVisited, ms: r.elapsedMs, contacts: r.contacts.length });
for (const c of r.contacts) console.log(' -', c.name || '(sem nome)', '|', c.role, '|', c.email, '|', c.phone, '|', c.source);
if (flags.includes('--attempts')) for (const a of r.attempts) console.log('   ·', a.status, a.url, a.reason || '');
console.log('warnings:', r.warnings);
