import * as cheerio from 'cheerio';
import { cleanEmail, emailKind, normalizePhone, uniq, SECTOR_PRIORITY, SECTOR_LABEL } from './text.js';
export { SECTOR_PRIORITY, SECTOR_LABEL };

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?55[\s-]*)?\(?0?\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}/g;

// Cargo -> setor. A ordem importa: específicos antes de genéricos.
export const ROLE_RULES = [
  [/vice[- ]?presidente/i, 'Vice-Presidente', 'mesa'],
  [/presidente(?! d[ae] comiss)|presid[êe]ncia/i, 'Presidente', 'decisor'],
  [/(?:1[ºo°]?|primeir[oa])\s*secret[áa]ri[oa]/i, '1º Secretário(a)', 'mesa'],
  [/(?:2[ºo°]?|segund[oa])\s*secret[áa]ri[oa]/i, '2º Secretário(a)', 'mesa'],
  [/diretor(?:a|ia)?[- ]geral|dire[çc][ãa]o geral/i, 'Diretor(a) Geral', 'decisor'],
  [/chefe de gabinete da presid|secret[áa]ri[oa][- ]geral/i, 'Secretaria-Geral', 'decisor'],
  [/diretor(?:a|ia)? administrativ|departamento administrativ/i, 'Diretoria Administrativa', 'decisor'],
  [/pregoeir|licita[çc]|compras|contrata[çc][õo]es|agente de contrata|suprimento/i, 'Licitações e Compras', 'compras'],
  [/tecnologia|inform[áa]tica|\bTI\b|\bCPD\b|sistemas|suporte t[ée]cnico/i, 'Tecnologia da Informação', 'ti'],
  [/comunica[çc][ãa]o|imprensa|assessoria de comunica|tv c[âa]mara|r[áa]dio|cerimonial|audiovisual/i, 'Comunicação', 'comunicacao'],
  [/patrim[ôo]nio|almoxarif|manuten[çc][ãa]o|infraestrutura|servi[çc]os gerais/i, 'Patrimônio e Infraestrutura', 'compras'],
  [/diretor(?:a|ia)? financeir|financeiro|contador|contabil|tesour/i, 'Financeiro e Contabilidade', 'financeiro'],
  [/diretor(?:a|ia)? legislativ|departamento legislativ/i, 'Diretoria Legislativa', 'gestao'],
  [/controlador|controle interno/i, 'Controle Interno', 'gestao'],
  [/procurador|jur[íi]dic|advogad/i, 'Procuradoria / Jurídico', 'gestao'],
  [/recursos humanos|\bRH\b|departamento de pessoal|gest[ãa]o de pessoas/i, 'Recursos Humanos', 'gestao'],
  [/ouvidor/i, 'Ouvidoria', 'atendimento'],
  [/protocolo|recep[çc][ãa]o|atendimento/i, 'Protocolo e Atendimento', 'atendimento'],
  [/diretor[a]?\b/i, 'Diretor(a)', 'gestao'],
  [/vereador|parlamentar/i, 'Vereador(a)', 'parlamentar'],
];

const LOCAL_PART_RULES = [
  [/^(presidencia|presidente|gabinetedapresidencia)/, 'Presidente', 'decisor'],
  [/^(diretoria|diretorgeral|diretoriageral|dg|secretariageral|direcao)/, 'Diretoria', 'decisor'],
  [/^(licita|compras|pregao|pregoeir|contrata|cpl)/, 'Licitações e Compras', 'compras'],
  [/^(ti|informatica|cpd|suporte|tecnologia|sistemas)/, 'Tecnologia da Informação', 'ti'],
  [/^(comunicacao|imprensa|ascom|tv|cerimonial)/, 'Comunicação', 'comunicacao'],
  [/^(financeiro|contabilidade|tesouraria)/, 'Financeiro e Contabilidade', 'financeiro'],
  [/^(rh|recursoshumanos|pessoal)/, 'Recursos Humanos', 'gestao'],
  [/^(juridico|procuradoria)/, 'Procuradoria / Jurídico', 'gestao'],
  [/^(controleinterno|controladoria)/, 'Controle Interno', 'gestao'],
  [/^(ouvidoria)/, 'Ouvidoria', 'atendimento'],
  [/^(protocolo|secretaria|atendimento|recepcao)/, 'Protocolo e Atendimento', 'atendimento'],
  [/^(legislativo|camara|cm|contato|faleconosco|sac|adm|administracao)/, 'Contato institucional', 'institucional'],
];

export function detectRole(text) {
  const t = String(text || '');
  for (const [re, role, sector] of ROLE_RULES) if (re.test(t)) return { role, sector };
  return { role: '', sector: '' };
}
export function roleFromEmail(email) {
  const local = String(email || '').split('@')[0].replace(/[^a-z]/g, '');
  for (const [re, role, sector] of LOCAL_PART_RULES) if (re.test(local)) return { role, sector };
  return { role: '', sector: '' };
}

export function decodeCfEmail(hex) {
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out;
  } catch { return ''; }
}

function deobfuscate(text) {
  return text
    .replace(/\s*(?:\[|\(|\{)\s*(?:at|arroba)\s*(?:\]|\)|\})\s*/gi, '@')
    .replace(/(\w)\s+arroba\s+(\w)/gi, '$1@$2')
    .replace(/\s*(?:\[|\(|\{)\s*(?:dot|ponto)\s*(?:\]|\)|\})\s*/gi, '.');
}

const NOT_NAME = /@|\d|telefone|e-?mail|contato|endere[çc]o|c[âa]mara|munic[íi]p|gabinete|hor[áa]rio|atendimento|fale conosco|clique|saiba|mais|ver |leia|partido|mandato|legislatura|ramal|whats|fax|perfil|biografia|vereadores|servidores|setor|departamento|diretoria|comiss/i;

export function plausibleName(value) {
  const v = String(value || '').replace(/\s+/g, ' ').replace(/^(?:vereador[a]?|ver\.|dr\.?|dra\.?|sr\.?|sra\.?)\s+/i, '').trim();
  if (v.length < 5 || v.length > 70 || NOT_NAME.test(v)) return '';
  const words = v.split(' ');
  if (words.length < 2 || words.length > 8) return '';
  const capitalized = words.filter(w => /^[A-ZÀ-Ý]/.test(w)).length;
  if (capitalized < Math.ceil(words.length * 0.6)) return '';
  // Nomes em CAIXA ALTA viram "Título".
  return v === v.toUpperCase()
    ? v.toLowerCase().replace(/(^|\s)(\S)/g, (m, s, c) => s + c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, w => w.toLowerCase())
    : v;
}

export function nameFromText(text) {
  const m = /(?:vereador[a]?|presidente|diretor[a]?(?: geral)?|secret[áa]ri[oa])\s*[:\-–]?\s*([A-ZÀ-Ý][\wÀ-ÿ'.]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\wÀ-ÿ'.]+){1,6})/.exec(text);
  return m ? plausibleName(m[1]) : '';
}

export function detectPlatform(html, url) {
  const h = String(html || '').slice(0, 300000);
  const u = String(url || '');
  const found = [];
  if (/\/\/sapl\.|sapl3|SAPL/i.test(u + h.slice(0, 20000)) && /sapl/i.test(u)) found.push('SAPL');
  if (/plone|portal modelo|interlegis/i.test(h)) found.push('Portal Modelo (Plone)');
  if (/wp-content|wp-includes/i.test(h)) found.push('WordPress');
  if (/joomla/i.test(h)) found.push('Joomla');
  if (/atende\.net|ipm sistemas/i.test(h)) found.push('IPM Atende.Net');
  if (/betha/i.test(h)) found.push('Betha');
  if (/portalfacil|portal f[áa]cil/i.test(h)) found.push('Portal Fácil');
  if (/instar/i.test(h)) found.push('Instar');
  if (/govbr|gov\.br\/ds|dsgov/i.test(h)) found.push('Padrão gov.br');
  if (/__next|_next\/static/i.test(h)) found.push('Next.js');
  const gen = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{2,60})/i.exec(h)?.[1];
  const genWord = (gen || '').trim().split(/[\s-]+/)[0].toLowerCase();
  if (gen && genWord && !found.join(' ').toLowerCase().includes(genWord)) found.push(gen.trim());
  return uniq(found).slice(0, 3).join(', ');
}

function labelled(text, label) {
  const re = new RegExp('(?:^|\\s)(?:' + label + ')\\s*:\\s*(.{1,145}?)(?=\\s+(?:Nome Completo|Nome Parlamentar|Partido|Telefones?|E-mail|Email|Homepage|Biografia|Número do Gabinete|Gabinete|Endereço|Mandato|Data de Nascimento|Profiss[ãa]o|Situa[çc][ãa]o)\\s*:|$)', 'i');
  return re.exec(text)?.[1]?.trim() || '';
}

/** Prepara o documento: decodifica e-mails protegidos e remove ruído. */
export function loadDocument(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,iframe,template').remove();
  $('[data-cfemail]').each((_, el) => { const e = decodeCfEmail($(el).attr('data-cfemail') || ''); if (e) $(el).replaceWith(e); });
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const e = decodeCfEmail(($(el).attr('href') || '').split('#')[1] || '');
    if (e) { $(el).attr('href', 'mailto:' + e); if (!$(el).text().includes('@')) $(el).text(e); }
  });
  $('a[href^="mailto:"]').each((_, el) => {
    const e = cleanEmail(decodeURIComponent(($(el).attr('href') || '').slice(7)));
    if (e && !$(el).text().toLowerCase().includes(e)) $(el).append(' ' + e);
  });
  $('a[href^="tel:"]').each((_, el) => {
    const p = ($(el).attr('href') || '').slice(4);
    if (!/\d{4}/.test($(el).text())) $(el).append(' ' + p);
  });
  $('br').replaceWith(' \n ');
  // Sem separador, células e blocos vizinhos se colam ("Martins" + "diretoria@..." = "martinsdiretoria@...").
  $('td,th,tr,li,p,div,h1,h2,h3,h4,h5,h6,dt,dd,section,article,header,footer,strong,b,span,a,label,small,em,option,figcaption').each((_, el) => { $(el).append(' '); });
  return $;
}

function textOf($, el) {
  return deobfuscate($(el).text().replace(/\s+/g, ' ').trim());
}

function phonesIn(text) {
  return uniq((text.match(PHONE_RE) || []).map(normalizePhone));
}

/** Extrai registros de contato de uma página HTML. */
export function extractContacts(html, url, ctx = {}) {
  const $ = loadDocument(html);
  const records = [];
  $('nav').remove();
  const fullText = textOf($, 'body');

  // 1) Perfil individual (SAPL /parlamentar/ID ou páginas com rótulos "Nome Completo:").
  if (/\/parlamentar\/\d+\/?(?:\?|$)/.test(url) || /Nome (?:Completo|Parlamentar)\s*:/i.test(fullText)) {
    const name = plausibleName(labelled(fullText, 'Nome Completo')) || plausibleName(labelled(fullText, 'Nome Parlamentar')) || plausibleName($('h1').first().text());
    const email = cleanEmail((labelled(fullText, 'E-mail|Email').match(EMAIL_RE) || [])[0]) || cleanEmail((fullText.match(EMAIL_RE) || [])[0]);
    const phone = phonesIn(labelled(fullText, 'Telefones?'))[0] || '';
    if (name && (email || phone)) {
      records.push({ name, role: 'Vereador(a)', sector: 'parlamentar', email, phone, source: url, type: 'perfil' });
      return records;
    }
  }

  // 2) "Cartões": para cada e-mail/telefone, sobe na árvore até um bloco com contexto suficiente.
  const seenCards = new Set();
  const anchors = [];
  $('body *').each((_, el) => {
    const own = $(el).contents().filter((__, n) => n.type === 'text').text();
    const href = $(el).attr('href') || '';
    if (EMAIL_RE.test(deobfuscate(own)) || /^mailto:/i.test(href)) anchors.push(el);
    EMAIL_RE.lastIndex = 0;
  });
  const emailCount = el => uniq((textOf($, el).match(EMAIL_RE) || []).map(cleanEmail)).length;
  for (const el of anchors.slice(0, 300)) {
    // Sobe na árvore enquanto o bloco continuar sendo "deste" contato: para antes de englobar outro e-mail.
    let card = el;
    const own = Math.max(1, emailCount(el));
    for (let depth = 0; depth < 6; depth++) {
      if (/^(tr|li|article|dd)$/.test(card.name) && textOf($, card).length > 40) break;
      const parent = card.parent;
      if (!parent || parent.type !== 'tag' || ['body', 'html', 'main'].includes(parent.name)) break;
      if (textOf($, parent).length > 600 || emailCount(parent) > own) break;
      card = parent;
    }
    if (seenCards.has(card)) continue;
    seenCards.add(card);
    const text = textOf($, card);
    if (text.length > 700) continue;
    const emails = uniq((text.match(EMAIL_RE) || []).map(cleanEmail));
    if (!emails.length) continue;
    const heading = $(card).find('h1,h2,h3,h4,h5,strong,b,.nome,.name,[class*=nome],[class*=title],td:first-child,th').toArray()
      .map(h => plausibleName($(h).text())).find(Boolean) || '';
    const name = heading || nameFromText(text);
    const { role, sector } = detectRole(text);
    const phone = phonesIn(text)[0] || '';
    for (const email of emails.slice(0, 3)) {
      const byEmail = roleFromEmail(email);
      records.push({ name, role: role || byEmail.role, sector: sector || byEmail.sector, email, phone, source: url, type: name ? 'diretório' : 'setor' });
    }
  }

  // 3) E-mails soltos (rodapé, páginas "Contato"): contato institucional por setor.
  const pagePhone = phonesIn(textOf($, 'footer') || '')[0] || phonesIn(fullText)[0] || '';
  for (const raw of uniq(fullText.match(EMAIL_RE) || []).slice(0, 40)) {
    const email = cleanEmail(raw);
    if (!email || records.some(r => r.email === email)) continue;
    const { role, sector } = roleFromEmail(email);
    records.push({ name: '', role: role || 'Contato institucional', sector: sector || 'institucional', email, phone: pagePhone, source: url, type: 'geral' });
  }
  if (!records.length && pagePhone) records.push({ name: '', role: 'Telefone institucional', sector: 'institucional', email: '', phone: pagePhone, source: url, type: 'geral' });
  return records;
}

const RELEVANT = [
  [/\/parlamentar\/\d+/i, 6],
  [/vereador|parlamentar|composi[çc][ãa]o|bancada/i, 5],
  [/mesa[- ]diretora|presid[êe]ncia/i, 5],
  [/telefones?(?:-|\s)?[uú]teis|ramais|lista[- ]de[- ]contatos|quem[- ]?[ée][- ]?quem|agenda[- ]telef/i, 6],
  [/fale[- ]conosco|contatos?\b/i, 4],
  [/servidores|estrutura[- ]organizacional|organograma|diretoria|setores|departamentos|equipe|gabinetes/i, 4],
  [/licita[çc]|pregoeir|compras|comiss[ãa]o de contrata/i, 2],
  [/ouvidoria|institucional|a[- ]c[âa]mara|sobre/i, 2],
];
const EXCLUDE = /noticia|news|galeria|foto|video|evento|agenda(?![- ]telef)|legisla[çc][ãa]o|\/leis?\b|materia|proposi|sess[ãa]o|sessoes|pauta|\/ata|diario|publica[çc]|login|acesso|calend|feed|rss|busca|search|\?page=|print|imprimir|download|\.(png|jpe?g|gif|svg|css|js|zip|rar|docx?|xlsx?|pptx?|mp[34]|pdf|odt)(\?|$)/i;

/** Links relevantes, avaliados por href E texto do âncora, ordenados por prioridade. */
export function relevantLinks(html, base, inScope) {
  const $ = cheerio.load(html);
  const out = new Map();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (/^(mailto|tel|javascript):|^#/i.test(href)) return;
    let u;
    try { u = new URL(href, base); } catch { return; }
    u.hash = '';
    if (!inScope(u)) return;
    const label = ($(a).text() + ' ' + ($(a).attr('title') || '')).replace(/\s+/g, ' ').trim().slice(0, 120);
    const hay = decodeURIComponent(u.pathname + ' ' + u.search) + ' ' + label;
    if (EXCLUDE.test(u.pathname + u.search) && !/\/parlamentar\/\d+/.test(u.pathname)) return;
    let score = 0;
    for (const [re, s] of RELEVANT) if (re.test(hay)) score = Math.max(score, s);
    if (!score) return;
    const prev = out.get(u.href);
    if (!prev || prev < score) out.set(u.href, score);
  });
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([url, score]) => ({ url, score }));
}

/** Confiança 0–100 do contato, com rótulo. */
export function scoreContact(c, officialHosts) {
  const kind = emailKind(c.email, officialHosts);
  let s = 0;
  if (kind === 'oficial') s += 35; else if (kind === 'governamental') s += 20; else if (kind === 'pessoal/gratuito') s += 12; else if (c.email) s += 8;
  if (c.name) s += 25;
  if (c.role && !/^Contato institucional$|^Telefone institucional$/.test(c.role)) s += 15;
  if (c.phone) s += 10;
  if (['api-sapl', 'perfil', 'cadastro-interlegis', 'cadastro-autoridades', 'manual'].includes(c.type)) s += 15;
  s = Math.min(100, s);
  return { emailKind: kind, confidence: s, confidenceLabel: s >= 70 ? 'alta' : s >= 45 ? 'média' : 'baixa', priority: SECTOR_PRIORITY[c.sector || ''] || 0 };
}

/** Deduplica por e-mail (ou nome+telefone), mantendo o registro mais completo e unindo fontes. */
export function mergeContacts(items, officialHosts = []) {
  const map = new Map();
  const richness = x => (x.name ? 4 : 0) + (x.email ? 2 : 0) + (x.phone ? 2 : 0) + (x.role && x.sector !== 'institucional' ? 2 : 0) + (['perfil', 'api-sapl'].includes(x.type) ? 3 : 0);
  for (const c of items) {
    if (!c.email && !c.phone) continue;
    const key = c.email ? 'e:' + c.email : c.name ? 'n:' + c.name.toLowerCase() : 'p:' + c.phone;
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...c }); continue; }
    const [best, other] = richness(c) > richness(cur) ? [{ ...c }, cur] : [cur, c];
    best.name ||= other.name; best.phone ||= other.phone;
    if (!best.role || best.sector === 'institucional') { if (other.role && other.sector !== 'institucional') { best.role = other.role; best.sector = other.sector; } }
    map.set(key, best);
  }
  // Registro só com telefone é descartado se o número já aparece em outro contato.
  const values = [...map.values()];
  const phonesWithEmail = new Set(values.filter(c => c.email).flatMap(c => String(c.phone).split(' / ')));
  return values.filter(c => c.email || !String(c.phone).split(' / ').every(p => phonesWithEmail.has(p)))
    .map(c => ({ ...c, ...scoreContact(c, officialHosts) }))
    .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || (a.name || '~').localeCompare(b.name || '~', 'pt-BR'));
}

/**
 * Extração para texto colado (sem HTML): cada e-mail usa as linhas vizinhas como "cartão",
 * sem atravessar a linha de outro e-mail.
 */
export function extractFromText(text, source) {
  const lines = deobfuscate(String(text)).replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const emailsOf = l => uniq((l.match(EMAIL_RE) || []).map(cleanEmail));
  const records = [];
  lines.forEach((line, i) => {
    const emails = emailsOf(line);
    if (!emails.length) return;
    const before = [];
    for (let j = i - 1; j >= Math.max(0, i - 4) && !emailsOf(lines[j]).length; j--) before.unshift(lines[j]);
    const after = [];
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2) && !emailsOf(lines[j]).length; j++) after.push(lines[j]);
    const window = [...before, line, ...after].join(' · ');
    const name = [...before].reverse().map(plausibleName).find(Boolean) || nameFromText(window);
    const { role, sector } = detectRole([...before, line].join(' '));
    // Telefone: linha do e-mail e seguintes (a linha anterior costuma pertencer ao contato anterior).
    const phone = phonesIn([line, ...after].join(' '))[0] || '';
    for (const email of emails.slice(0, 3)) {
      const byMail = roleFromEmail(email);
      records.push({ name, role: role || byMail.role || 'Contato institucional', sector: sector || byMail.sector || 'institucional', email, phone, source, type: 'manual' });
    }
  });
  if (!records.length) for (const phone of phonesIn(lines.join(' ')).slice(0, 5)) records.push({ name: '', role: 'Telefone', sector: 'institucional', email: '', phone, source, type: 'manual' });
  return records;
}
