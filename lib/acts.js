import * as cheerio from 'cheerio';
import { detectRole, plausibleName } from './extract.js';
import { cityKey, uniq } from './text.js';

// Robô de atos oficiais: lê Portarias, Atos da Mesa/Presidência, Resoluções e publicações do Diário Oficial
// publicados no próprio site da Câmara e extrai nomeações/designações ("NOMEAR Fulano para o cargo de Diretor Geral").
// Exonerações posteriores retiram a pessoa da lista, para manter apenas quem está no cargo atualmente.

/** Links que levam a listagens de atos oficiais. */
export const ACT_LISTING = /portarias?\b|atos?[\s_-]+(?:oficia(?:l|is)|administrativos?|normativos?|d[ao][\s_-]+(?:mesa|presid))|publica[çc][õo]es[\s_-]+oficiais|publicacoes-oficiais|di[áa]rio[\s_-]+oficial|diariooficial|nomea[çc][õo]es|designa[çc][õo]es|resolu[çc][õo]es[\s_-]+da[\s_-]+mesa|atos-da-mesa|atos-da-presidencia/i;
/** Atos de pessoal (o que interessa para contatos). */
const PERSONNEL = /nomei?a|nomea[çcr]|designa|cargo|comiss[ãa]o|comissionad|exonera|funcionalismo|pessoal|servidor|lota[çc][ãa]o|gratifica[çc]|fun[çc][ãa]o de confian/i;
const NOT_PERSONNEL = /di[áa]ria|viagem|f[ée]rias|licen[çc]a|aposentad|abono|suprimento de fundos|adiantamento|ressarc|reembolso|comiss[ãa]o (?:de|para) (?:licita|avalia|inventa|processo|sindic|recebimento)|sindic[âa]ncia|PAD\b|processo administrativo|recesso|ponto facultativo|expediente/i;
const DOC_STORAGE = /cloudsoftcam\.com\.br|amazonaws\.com|cloudfront\.net|atende\.net|digitaloceanspaces\.com|wls\.com\.br|govbr\.cloud|ipm\.com\.br|elotech|betha\.cloud|storage\.googleapis\.com/i;

const STOP = new Set(['para', 'portador', 'portadora', 'inscrito', 'inscrita', 'cpf', 'rg', 'no', 'na', 'nos', 'nas', 'ao', 'à', 'como', 'brasileiro', 'brasileira', 'matricula', 'matrícula', 'lotado', 'lotada', 'ocupante', 'residente', 'sob', 'pelo', 'pela', 'com', 'em', 'cargo', 'função', 'funcao', 'a', 'o', 'as', 'os', 'partir', 'servidor', 'servidora', 'titular', 'efetivo', 'efetiva', 'que', 'nomeado', 'nomeada', 'designado', 'designada', 'exercer', 'conforme', 'nos', 'termos', 'abaixo', 'relacionado', 'relacionada']);
const CONNECT = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'De', 'Da', 'Do', 'Das', 'Dos', 'E', 'DE', 'DA', 'DO', 'DAS', 'DOS']);

function titleCase(s) {
  return s === s.toUpperCase()
    ? s.toLowerCase().replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E|Em|Com|Para|Ao|À)\b/g, w => w.toLowerCase())
    : s;
}

/** Pega o nome próprio logo após o verbo (aceita CAIXA ALTA), parando em palavras de contexto. */
function nameAfter(segment) {
  const s = segment
    .replace(/^[\s,:;–-]*/, '')
    .replace(/^(?:,?\s*a\s+partir\s+de\s+[^,]{3,40},\s*)/i, '')
    .replace(/^(?:(?:o|a|os|as)\s*(?:\(a\))?\s+)?(?:(?:servidor|servidora|senhor|senhora|sr\.?|sra\.?|vereador|vereadora)\s*(?:\(a\))?\s*[:,]?\s+)?/i, '')
    .replace(/^(?:efetiv[oa]\s+)?/i, '');
  const words = s.split(/\s+/).slice(0, 12);
  const out = [];
  for (const raw of words) {
    const w = raw.replace(/[,.;:()]+$/, '');
    if (!w) break;
    if (STOP.has(w.toLowerCase()) && !(CONNECT.has(w) && out.length)) break;
    if (CONNECT.has(w)) { if (out.length) { out.push(w); continue; } break; }
    if (!/^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+$/.test(w)) break;
    out.push(w);
    if (/[,;:]$/.test(raw)) break;
  }
  while (out.length && CONNECT.has(out[out.length - 1])) out.pop();
  if (out.length < 2) return '';
  const joined = titleCase(out.join(' ')).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, w => w.toLowerCase());
  return plausibleName(joined);
}

function cargoAfter(segment) {
  // "ocupante do cargo efetivo de X, para exercer a função de Y" → Y é o cargo atual relevante.
  const target = /\bpara\b[^.;]{0,70}?\b(?:cargo|fun[çc][ãa]o|emprego)\b/i.exec(segment);
  if (target) segment = segment.slice(target.index);
  const m = /\b(?:cargo|fun[çc][ãa]o|emprego)\b\s*(?:de\s+provimento\s+em\s+comiss[ãa]o|em\s+comiss[ãa]o|comissionad[oa]|gratificad[oa]|de\s+confian[çc]a|p[úu]blic[oa]|efetiv[oa])?\s*,?\s*(?:de|do|da)?\s*[:\-–]?\s*["“]?([^,.;:()\n"”]{3,90})/i.exec(segment);
  if (!m) return '';
  let c = m[1]
    .replace(/\s+(?:s[íi]mbolo|padr[ãa]o|n[íi]vel|refer[êe]ncia|c[óo]digo|CC[- ]?\d|DAS[- ]?\d|com\s+lota|lotad|junto|da\s+estrutura|do\s+quadro|a\s+partir|com\s+carga|com\s+venc|nos\s+termos|conforme|desta\s+(?:casa|c[âa]mara)|da\s+c[âa]mara|do\s+poder|deste\s+poder|do\s+legislativo|com\s+efeito|em\s+substitui)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ').trim();
  if (/^(?:em comiss[ãa]o|comissionad[oa]|p[úu]blico|efetivo)$/i.test(c) || c.length < 3) return '';
  return titleCase(c);
}

function actRef(text) {
  const m = /(portaria|ato(?:\s+da\s+(?:mesa|presid[êe]ncia))?|resolu[çc][ãa]o|decreto(?:\s+legislativo)?)\s*(?:n[º°o.]*|n[úu]mero)?\s*[:.]?\s*(\d{1,5})\s*[\/\-–]\s*(20\d{2})/i.exec(text);
  if (m) return { label: `${titleCase(m[1]).replace(/^\w/, c => c.toUpperCase())} ${m[2]}/${m[3]}`, year: Number(m[3]) };
  const y = /\b(20[0-3]\d)\b/.exec(text);
  return { label: '', year: y ? Number(y[1]) : 0 };
}

/**
 * Extrai nomeações/designações de um texto de ato oficial.
 * Retorna { appointments: [{name, role, sector, ref, year}], dismissals: [{name, year}] }.
 */
export function extractActs(text, { now = new Date() } = {}) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const appointments = [], dismissals = [];
  if (!PERSONNEL.test(flat)) return { appointments, dismissals };
  const VERB = /\b(nomear|nomeia|nomeando|fica\s+nomead[oa]|designar|designa|designando|fica\s+designad[oa]|exonerar|exonera|exonerando|fica\s+exonerad[oa])\b/gi;
  const docRef = actRef(flat.slice(0, 600));
  let m;
  while ((m = VERB.exec(flat))) {
    const after = flat.slice(m.index + m[0].length, m.index + m[0].length + 420);
    const local = actRef(flat.slice(Math.max(0, m.index - 400), m.index));
    const ref = local.label ? local : docRef;
    const name = nameAfter(after);
    if (!name) continue;
    if (/exoner/i.test(m[1])) { dismissals.push({ name, year: ref.year || docRef.year }); continue; }
    const cargo = cargoAfter(after.slice(0, 380));
    if (!cargo) continue;
    if (NOT_PERSONNEL.test(cargo)) continue;
    const { role, sector } = detectRole(cargo);
    appointments.push({ name, role: cargo.length <= 60 ? cargo : role || cargo.slice(0, 60), sector: sector || 'gestao', ref: ref.label, year: ref.year || docRef.year });
  }
  const minYear = now.getFullYear() - 3;
  return {
    appointments: appointments.filter(a => !a.year || a.year >= minYear),
    dismissals,
  };
}

/** Converte nomeações em registros de contato, removendo quem foi exonerado depois. */
export function actRecords(collected, source, ctx = {}) {
  const lastDismissal = new Map();
  for (const d of collected.dismissals) {
    const k = cityKey(d.name);
    lastDismissal.set(k, Math.max(lastDismissal.get(k) || 0, d.year || 0));
  }
  const byName = new Map();
  for (const a of collected.appointments) {
    const k = cityKey(a.name);
    const out = lastDismissal.get(k);
    if (out !== undefined && (!a.year || out >= a.year)) continue;
    const prev = byName.get(k);
    if (!prev || (a.year || 0) >= (prev.year || 0)) byName.set(k, a);
  }
  return [...byName.values()].map(a => ({
    name: a.name,
    role: a.ref ? `${a.role} · ${a.ref}` : a.role,
    sector: a.sector,
    email: ctx.fallbackEmail || '',
    phone: ctx.fallbackPhone || '',
    source: a.source || source,
    type: 'ato-oficial',
  }));
}

/**
 * Links de atos oficiais em uma página: listagens (menus "Portarias", filtros por ano) e documentos (PDF ou detalhe).
 * Pontuação maior = mais recente / mais provável de conter nomeações.
 */
export function actLinks(html, base, inScope, { now = new Date() } = {}) {
  const $ = cheerio.load(html);
  const listings = new Map(), docs = new Map();
  const thisYear = now.getFullYear();
  const baseIsListing = ACT_LISTING.test(decodeURIComponent(base)) || ACT_LISTING.test($('h1,h2,title').text());
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || /^(mailto|tel|javascript):|^#/i.test(href)) return;
    let u; try { u = new URL(href, base); } catch { return; }
    u.hash = '';
    const isPdf = /\.pdf(\?|$)/i.test(u.pathname);
    if (!inScope(u) && !(isPdf && DOC_STORAGE.test(u.hostname))) return;
    const label = ($(el).text() + ' ' + ($(el).attr('title') || '')).replace(/\s+/g, ' ').trim();
    // Linha da tabela/lista: dá contexto (ementa, tipo, data) a links curtos como "0107-2025".
    const row = $(el).closest('tr,li,article,.card,.item').text().replace(/\s+/g, ' ').trim().slice(0, 400);
    const ctx = label + ' ' + row;
    const hay = decodeURIComponent(u.pathname + ' ' + u.search) + ' ' + label;
    const year = Number((/\b(20[0-3]\d)\b/.exec(ctx) || [])[1] || 0);
    if (year && year < thisYear - 3) return;
    const recency = year ? Math.max(0, 3 - (thisYear - year)) : 1;

    if (baseIsListing && /^20[0-3]\d$/.test(label)) { listings.set(u.href, Math.max(listings.get(u.href) || 0, 2 + recency)); return; }
    if (ACT_LISTING.test(hay) && !isPdf && !/\b\d{1,5}\s*[\/-]\s*20\d{2}\b/.test(label)) {
      listings.set(u.href, Math.max(listings.get(u.href) || 0, 3 + recency));
      return;
    }
    if (!baseIsListing && !ACT_LISTING.test(ctx)) return;
    if (NOT_PERSONNEL.test(row) && !/nomei?a|designa|exonera/i.test(row)) return;
    const personnel = PERSONNEL.test(ctx);
    if (!personnel && !isPdf) return;
    const score = (personnel ? 4 : 1) + recency + (isPdf ? 1 : 0);
    if (score > (docs.get(u.href) || 0)) docs.set(u.href, score);
  });
  const sort = m => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([url, score]) => ({ url, score }));
  return { listings: sort(listings), docs: sort(docs) };
}

export function isActText(text) {
  return PERSONNEL.test(text) && /\b(?:nomear|nomeia|designar|designa|exonerar|exonera)\b/i.test(text);
}

export { uniq };
