// Uso: node scripts/audit-csv.mjs "contatos-camaras-pr.csv" [saida.csv]
// Audita um CSV de contatos já exportado: reconstrói o site usado em cada município, aplica a verificação
// institucional e a verificação entre municípios, e grava o relatório de inconsistências com a decisão de cada vínculo.
import { readFileSync, writeFileSync } from 'node:fs';
import { crossCheck, qualityReport } from '../lib/crosscheck.js';
import { classifyContact } from '../lib/validate.js';

const [input, output = 'inconsistencias.csv'] = process.argv.slice(2);
const text = readFileSync(input, 'utf8').replace(/^\uFEFF/, '');
const parseLine = l => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ';') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const lines = text.split(/\r?\n/).filter(Boolean);
const head = parseLine(lines[0]);
const idx = n => head.indexOf(n);
const rows = lines.slice(1).map(parseLine);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\d?\./, ''); } catch { return ''; } };

const byCity = new Map();
for (const r of rows) {
  const city = r[idx('Município')];
  const c = { name: r[idx('Nome')], role: r[idx('Cargo')], email: r[idx('E-mail')], phone: r[idx('Telefone')], type: r[idx('Origem')], source: r[idx('Fonte')] };
  (byCity.get(city) || byCity.set(city, []).get(city)).push(c);
}
const results = [];
for (const [city, contacts] of byCity) {
  // Site "oficial" que a versão anterior usou: o host .leg.br/.gov.br mais frequente nas fontes do município.
  const freq = new Map();
  for (const c of contacts) { const h = hostOf(c.source); if (/\.(leg|gov)\.br$/.test(h) && !/senado|casacivil|tce|pncp/.test(h)) freq.set(h.replace(/^sapl\./, ''), (freq.get(h.replace(/^sapl\./, '')) || 0) + 1); }
  const site = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const siteHosts = new Set(site ? [site] : []);
  // Reclassifica cada contato com as regras novas (órgão externo, domínio de outro município...).
  const review = [], keep = [];
  for (const c of contacts) {
    const v = classifyContact(c, { city, uf: 'PR', siteHosts, siteValidated: !!site });
    const cc = { ...c, validation: v.validation, validationReason: v.reason, evidence: v.evidence.join('; ') };
    (['SUSPEITO', 'ORGAO_EXTERNO'].includes(v.validation) ? review : keep).push(cc);
  }
  results.push({ id: city, city, officialSite: site ? 'https://www.' + site : '', saplUrl: site ? 'https://sapl.' + site : '', contacts: keep, review });
}
const { results: checked, decisions } = crossCheck(results);
const q = qualityReport(checked, decisions);
const esc = v => '"' + String(v ?? '').replaceAll('"', '""') + '"';
const out = [['E-mail', 'Municípios envolvidos', 'Município da ocorrência', 'Cargo', 'Fonte', 'Evidência', 'Motivo', 'Decisão']];
for (const d of decisions) out.push([d.email, d.municipios, d.municipio, d.cargo, d.fonte, d.evidencia, d.motivo, d.decisao]);
for (const r of checked) for (const c of r.review || []) if (!decisions.some(d => d.email === c.email && d.municipio === r.city)) out.push([c.email, r.city, r.city, c.role, c.source, c.evidence, c.validationReason, c.validation === 'ORGAO_EXTERNO' ? 'separado (órgão externo)' : 'separado para revisão']);
writeFileSync(output, '\uFEFF' + out.map(r => r.map(esc).join(';')).join('\r\n'));
const multiBefore = (() => { const m = new Map(); for (const [city, cs] of byCity) for (const c of cs) if (c.email) (m.get(c.email.toLowerCase()) || m.set(c.email.toLowerCase(), new Set()).get(c.email.toLowerCase())).add(city); return [...m.values()].filter(s => s.size > 1).length; })();
const multiAfter = (() => { const m = new Map(); for (const r of checked) for (const c of r.contacts) if (c.email) (m.get(c.email.toLowerCase()) || m.set(c.email.toLowerCase(), new Set()).get(c.email.toLowerCase())).add(r.city); return [...m.entries()].filter(([, s]) => s.size > 1); })();
console.log(JSON.stringify({ linhas: rows.length, municipios: byCity.size, emailsEmVariosMunicipiosAntes: multiBefore, emailsEmVariosMunicipiosDepois: multiAfter.length, compartilhadosMantidos: multiAfter.map(([e, s]) => `${e}: ${[...s].join(', ')}`), ...q, semContatoConfiavel: q.semContatoConfiavel.length }, null, 1));
console.log('decisões:', decisions.reduce((m, d) => (m[d.decisao] = (m[d.decisao] || 0) + 1, m), {}));
