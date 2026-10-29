// Verificação real: municípios com e-mails cruzados na planilha + regressão.
import { scanCamara } from '../lib/crawler.js';
import { fetchRegistryPage } from '../lib/registry.js';
import { matchRegistry } from '../lib/text.js';
import { crossCheck, qualityReport } from '../lib/crosscheck.js';
import { writeFileSync } from 'node:fs';

const uf = 'PR';
const cities = process.argv.slice(2).filter(a => !a.startsWith('--'));
const out = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6);
const first = await fetchRegistryPage(uf, 1);
const entries = [...first.entries];
for (let p = 2; p <= (first.lastPage || 1); p++) entries.push(...(await fetchRegistryPage(uf, p)).entries);
const results = [];
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < cities.length) {
    const city = cities[cursor++];
    const hint = matchRegistry(entries, city);
    const r = await scanCamara(city, uf, { fast: true, hint: hint ? { ...hint, registrySource: 'https://www12.senado.leg.br/interlegis/orgaosatendidos?uf=PR' } : null });
    results.push({ id: city, city, status: r.status, officialSite: r.officialSite, saplUrl: r.saplUrl, contacts: r.contacts, review: r.review, quality: r.quality, siteValidation: r.siteValidation });
    console.log(`${city.padEnd(22)} ${r.status.padEnd(18)} site=${r.officialSite || '-'} | hint=${hint?.city || '-'} | ${r.quality.validated} validados, ${r.quality.notValidated} não val., ${r.quality.suspicious} suspeitos, ${r.quality.external} externos`);
    for (const c of r.review) console.log(`      ↳ separado: ${c.email} — ${c.validation}: ${c.validationReason}`);
    if (r.siteValidation) console.log(`      ✓ ${r.siteValidation.evidence.join(' · ')}`);
  }
}));
const { results: checked, decisions } = crossCheck(results);
console.log('\nDECISÕES ENTRE MUNICÍPIOS:');
for (const d of decisions) console.log(` ${d.email} | ${d.municipio} | ${d.decisao} | ${d.motivo}`);
console.log('\nQUALIDADE:', JSON.stringify(qualityReport(checked, decisions), null, 1));
if (out) writeFileSync(out, JSON.stringify({ results: checked, decisions }, null, 1));
