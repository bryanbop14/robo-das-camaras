import { registryLines } from './registry.js';
import { safeFetch } from './net.js';
import { cityKey, cleanEmail, normalizePhone, uniq } from './text.js';

// Cadastro Geral de Autoridades do Paraná (Casa Civil/PR): traz nome do Presidente de cada Câmara.
const GCAU_PR = 'https://www.gcau-consulta.casacivil.pr.gov.br/gcau_internet/servicoLivreConsultaAgrupadorInternet.do?action=pesquisarPorAgrupadorInternet&codAgrupadorInternet=131';
const TTL = 6 * 60 * 60 * 1000;
let gcauCache = null;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?:\+?55[\s-]*)?\(?\d{2}\)?[\s-]*\d{4,5}[\s.-]?\d{4}/g;

async function gcauLines() {
  if (gcauCache && Date.now() - gcauCache.time < TTL) return gcauCache;
  const r = await safeFetch(GCAU_PR, { timeout: 12000, maxBytes: 9_000_000 });
  const data = { time: Date.now(), status: r.status, lines: r.status === 200 ? registryLines(r.html) : [] };
  if (r.status === 200) gcauCache = data;
  return data;
}

export function findGcau(lines, city, source) {
  const key = cityKey(city);
  const isTarget = l => {
    const m = /^PRESIDENTE(?: INTERINO)? DA C[ÂA]MARA MUNICIPAL DE (.+)$/i.exec(l);
    return m && cityKey(m[1]) === key;
  };
  for (let i = 0; i < lines.length; i++) {
    if (!isTarget(lines[i])) continue;
    const preceding = lines.slice(Math.max(0, i - 7), i).reverse();
    const name = preceding.find(line => {
      const words = line.trim().split(/\s+/);
      return words.length >= 2 && words.length <= 9 && line.length <= 95 &&
        /^[A-ZÀ-ÝÇÃÕÂÊÔÍÚÉÓÁÜ\s'’.-]+$/.test(line) &&
        !/PRESIDENTE|CÂMARA|CAMARA|E-MAIL|TELEFONE|GERAR PDF|LEGISLATIVO|AUTORIDADES/.test(line);
    }) || '';
    const info = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
      if (/^PRESIDENTE|^C[ÂA]MARA MUNICIPAL DE /i.test(lines[j])) break;
      info.push(lines[j]);
    }
    const text = info.join(' ');
    const email = cleanEmail((text.match(EMAIL_RE) || [])[0]);
    const phone = uniq((text.match(PHONE_RE) || []).map(normalizePhone)).slice(0, 2).join(' / ');
    const pretty = name.toLowerCase().replace(/(^|\s)(\S)/g, (m, s, c) => s + c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, w => w.toLowerCase());
    if (email || phone) return [{ name: pretty, role: 'Presidente da Câmara', sector: 'decisor', email, phone, source, type: 'cadastro-autoridades' }];
  }
  return [];
}

/** Fontes oficiais estaduais complementares. Hoje: GCAU (PR). */
export async function stateSources(city, uf) {
  if (uf !== 'PR') return { contacts: [], attempts: [] };
  const page = await gcauLines();
  const contacts = page.lines.length ? findGcau(page.lines, city, GCAU_PR) : [];
  return {
    contacts,
    attempts: [{ url: GCAU_PR, status: page.status, reason: contacts.length ? 'Cadastro de autoridades/PR: presidente localizado' : 'Cadastro de autoridades/PR sem registro para o município' }],
  };
}
