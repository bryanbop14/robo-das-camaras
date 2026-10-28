import * as cheerio from 'cheerio';
import { safeFetch } from './net.js';
import { cityKey, cleanEmail, normalizePhone, uniq, UF_SET } from './text.js';

// Cadastro público de órgãos atendidos pelo Interlegis (Senado Federal).
// Cada Câmara traz CNPJ, endereço, e-mail, telefone e as URLs oficiais dos serviços (.leg.br, Portal Modelo, SAPL).
export const REGISTRY_BASE = 'https://www12.senado.leg.br/interlegis/orgaosatendidos';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();

const SERVICE_NAMES = [
  ['SAPL', /^SAPL$/i],
  ['SAAP', /^SAAP$/i],
  ['Portal Modelo', /^Portal Modelo$/i],
  ['Domínio .LEG.br', /^Dom[ií]nio \.LEG\.br$/i],
  ['Domínio .GOV.br', /^Dom[ií]nio \.GOV\.br$/i],
  ['E-mail Legislativo', /^E-?mail Legislativo$/i],
];
const SERVICE_STATUS = /^(Funcionando|N[ãa]o funcionando|N[ãa]o verificado|Fora do ar|Inativo|Erro.*|Desativado)$/i;
const CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
const CEP_LINE = /^(\d{5}-?\d{3})\s*-\s*(.+?),\s*([A-Z]{2})$/;
const HEADING = /^C[âa]mara (?:Municipal d[eoa]s? |Legislativa)/i;
const TYPE_LINE = /^(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s*-\s*)?(?:C[âa]mara Municipal|C[âa]mara Legislativa)$/i;
const ANY_TYPE_LINE = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s*-\s*\S/;
const URL_RE = /https?:\/\/[^\s|<>"')]+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /(?:\+?55[\s-]*)?\(?\d{2}\)?[\s-]*\d{4,5}[\s.-]?\d{4}/g;
const IGNORED_URL = /senado\.leg\.br|interlegis\.leg\.br|camara\.leg\.br\/?$|gescon|\.pdf(\?|$)/i;

export function registryLines(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,header,footer,nav').remove();
  // O href nem sempre aparece no texto da célula: anexa-o para não perder URLs de serviços.
  $('a[href]').each((_, a) => {
    const el = $(a), href = el.attr('href') || '';
    if (/^https?:\/\//i.test(href) && !el.text().includes(href.replace(/\/$/, ''))) el.append(' ' + href);
    if (/^tel:/i.test(href) && !/\d{4}/.test(el.text())) el.append(' ' + href.slice(4));
  });
  $('br').replaceWith('\n');
  $('tr,td,th,p,h1,h2,h3,h4,h5,dt,dd,li,div,article,section').each((_, el) => { $(el).prepend('\n'); $(el).append('\n'); });
  return $('body').text().split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function isHeadingAt(lines, i) {
  if (!HEADING.test(lines[i]) || lines[i].replace(URL_RE, '').length > 110) return false;
  return TYPE_LINE.test(lines[i + 1] || '') || TYPE_LINE.test(lines[i + 2] || '');
}

function serviceNameOf(line) {
  return SERVICE_NAMES.find(([, re]) => re.test(line))?.[0] || '';
}

export function parseEntries(lines, uf) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) if (isHeadingAt(lines, i)) heads.push(i);
  const entries = [];
  heads.forEach((start, idx) => {
    let end = idx + 1 < heads.length ? heads[idx + 1] : Math.min(lines.length, start + 160);
    // Interrompe o bloco se surgir outro órgão (ex.: Assembleia, Tribunal) antes da próxima Câmara.
    for (let k = start + 3; k < end; k++) if (ANY_TYPE_LINE.test(lines[k]) && !TYPE_LINE.test(lines[k])) { end = k - 1; break; }
    const block = lines.slice(start, end);
    const heading = block[0].replace(URL_RE, '').trim();
    const typeIdx = block.findIndex((l, j) => j > 0 && TYPE_LINE.test(l));
    const cepIdx = block.findIndex((l, j) => j > typeIdx && CEP_LINE.test(l));
    const convIdx = block.findIndex(l => /^Conv[êe]nios$|^Serviços Interlegis$|^Oficinas Realizadas$/i.test(l));
    const head = block.slice(0, convIdx > 0 ? convIdx : Math.min(block.length, 12));
    const cnpj = (block[typeIdx]?.match(CNPJ) || [])[0] || '';
    const cep = cepIdx > 0 ? CEP_LINE.exec(block[cepIdx]) : null;
    const entryUf = cep?.[3] || uf;
    if (uf && entryUf !== uf) return;
    const nameCity = heading.replace(/^C[âa]mara Municipal d[eoa]s?\s+/i, '').replace(/\s*[-–(].*$/, '').trim();
    const city = /Legislativa/i.test(heading) ? (uf === 'DF' ? 'Brasília' : nameCity) : (cep?.[2] || nameCity);
    const address = cepIdx > typeIdx + 1 ? block.slice(typeIdx + 1, cepIdx).join(', ') : '';
    const headText = head.slice(Math.max(1, cepIdx + 1)).join(' ');
    const email = uniq((headText.match(EMAIL_RE) || []).map(cleanEmail))[0] || '';
    const phones = uniq((headText.replace(CNPJ, ' ').match(PHONE_RE) || []).map(normalizePhone));

    const services = [];
    const svcStart = block.findIndex(l => /^Serviços Interlegis$/i.test(l));
    if (svcStart >= 0) {
      const svcLines = block.slice(svcStart + 1);
      svcLines.forEach((line, j) => {
        const urls = (line.match(URL_RE) || []).map(u => u.replace(/[.,;]+$/, '')).filter(u => !IGNORED_URL.test(u));
        if (!urls.length) return;
        let type = '';
        for (let b = j; b >= Math.max(0, j - 4) && !type; b--) type = serviceNameOf(svcLines[b]);
        let status = '';
        for (let f = j + 1; f < Math.min(svcLines.length, j + 5) && !status; f++) if (SERVICE_STATUS.test(svcLines[f])) status = svcLines[f];
        for (const url of urls) if (!services.some(s => s.url === url)) services.push({ type: type || (/\/\/sapl\./i.test(url) ? 'SAPL' : 'Site'), url, status });
      });
    }
    const working = s => !s.status || /funcionando/i.test(s.status) && !/n[ãa]o/i.test(s.status);
    const pick = (...types) => {
      for (const t of types) {
        const s = services.find(x => x.type === t && working(x)) || null;
        if (s) return s.url;
      }
      return '';
    };
    const sapl = pick('SAPL') || services.find(s => /\/\/sapl\./i.test(s.url))?.url || '';
    const site = pick('Portal Modelo', 'Domínio .LEG.br', 'Domínio .GOV.br', 'Site') ||
      services.find(s => s.type !== 'SAPL' && s.type !== 'E-mail Legislativo' && s.type !== 'SAAP')?.url || '';
    entries.push({
      name: heading, city, cityKey: cityKey(city), uf: entryUf, cnpj, address,
      cep: cep?.[1] || '', email, phone: phones.slice(0, 2).join(' / '),
      site, sapl, services: services.filter(s => s.type !== 'E-mail Legislativo'),
    });
  });
  // Deduplica (a mesma Câmara pode aparecer duas vezes na mesma página).
  const seen = new Map();
  for (const e of entries) {
    const k = e.cnpj || e.cityKey;
    const prev = seen.get(k);
    if (!prev || (e.services.length + (e.email ? 1 : 0)) > (prev.services.length + (prev.email ? 1 : 0))) seen.set(k, e);
  }
  return [...seen.values()];
}

export function lastPage(html, uf) {
  const $ = cheerio.load(html);
  let max = 1;
  $('a[href*="orgaosatendidos"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!new RegExp('[?&]uf=' + uf + '(&|$)').test(href) || /[?&](servico|convenio)=/.test(href)) return;
    const p = Number(/[?&]p=(\d+)/.exec(href)?.[1]);
    if (p > max && p < 400) max = p;
  });
  return max;
}

export function registryUrl(uf, page) {
  return REGISTRY_BASE + '?uf=' + uf + (page > 1 ? '&p=' + page : '');
}

export async function fetchRegistryPage(uf, page = 1) {
  if (!UF_SET.has(uf)) throw new Error('UF inválida');
  const key = uf + ':' + page;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_TTL) return hit.data;
  const url = registryUrl(uf, page);
  let r = await safeFetch(url, { timeout: 15000, maxBytes: 6_000_000 });
  if (r.status !== 200) r = await safeFetch(url, { timeout: 15000, maxBytes: 6_000_000 });
  if (r.status !== 200) return { uf, page, status: r.status, entries: [], lastPage: null, source: url };
  const data = { uf, page, status: 200, entries: parseEntries(registryLines(r.html), uf), lastPage: lastPage(r.html, uf), source: url };
  cache.set(key, { time: Date.now(), data });
  if (cache.size > 1500) cache.delete(cache.keys().next().value);
  return data;
}
