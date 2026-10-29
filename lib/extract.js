import * as cheerio from 'cheerio';
import { cityKey, cleanEmail, emailKind, normalizePhone, uniq, SECTOR_PRIORITY, SECTOR_LABEL } from './text.js';
export { SECTOR_PRIORITY, SECTOR_LABEL };

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?55[\s-]*)?\(?0?\d{2}\)?[\s.-]*9?[\s.]?\d{4}\s*[-.]?\s*\d{4}/g;
const CHAINED_PHONE_RE = /\(?0?(\d{2})\)?[\s.-]*(9?[\s.]?\d{4}\s*[-.]?\s*\d{4})(?:\s*(?:[-–/]|e|\s)\s*(9?[\s.]?\d{4}\s*[-.]?\s*\d{4}))+/g;

// Cargo -> setor. A ordem importa: específicos antes de genéricos.
export const ROLE_RULES = [
  [/vice[- ]?presidente/i, 'Vice-Presidente', 'mesa'],
  [/presidente\s+da\s+(?:cpl|comiss[ãa]o\s+(?:permanente\s+)?de\s+licita)/i, 'Presidente da Comissão de Licitação', 'compras'],
  [/presidente(?! d[ae] comiss)|presid[êe]ncia/i, 'Presidente', 'decisor'],
  [/(?:1[ºo°]?|primeir[oa])\s*secret[áa]ri[oa]/i, '1º Secretário(a)', 'mesa'],
  [/(?:2[ºo°]?|segund[oa])\s*secret[áa]ri[oa]/i, '2º Secretário(a)', 'mesa'],
  [/diretor(?:a|ia)?[- ]geral|dire[çc][ãa]o geral/i, 'Diretor(a) Geral', 'decisor'],
  [/chefe de gabinete da presid|secret[áa]ri[oa][- ]geral|secret[áa]ri[oa]\s+executiv[oa]/i, 'Secretaria-Geral', 'decisor'],
  [/diretor(?:a|ia)? administrativ|departamento administrativ/i, 'Diretoria Administrativa', 'decisor'],
  [/pregoeir|licita[çc]|compras|contrata[çc][õo]es|agente de contrata|suprimento|\bcpl\b/i, 'Licitações e Compras', 'compras'],
  [/tecnologia|inform[áa]tica|\bTI\b|\bCPD\b|sistemas|suporte t[ée]cnico/i, 'Tecnologia da Informação', 'ti'],
  [/comunica[çc][ãa]o|imprensa|assessoria de comunica|tv c[âa]mara|r[áa]dio|cerimonial|audiovisual/i, 'Comunicação', 'comunicacao'],
  [/zelador[a]?|auxiliar de servi[çc]os gerais|motorista/i, 'Zeladoria / Serviços Gerais', 'gestao'],
  [/patrim[ôo]nio|almoxarif|manuten[çc][ãa]o|infraestrutura|servi[çc]os gerais/i, 'Patrimônio e Infraestrutura', 'compras'],
  [/contador[a]?|t[ée]cnico em contabilidade/i, 'Contador(a)', 'financeiro'],
  [/diretor(?:a|ia)? financeir|financeiro|contabil|tesour/i, 'Financeiro e Contabilidade', 'financeiro'],
  [/oficial legislativ[oa]|assistente legislativ[oa]|auxiliar legislativ[oa]|t[ée]cnico legislativ[oa]|agente legislativ[oa]/i, 'Oficial Legislativo', 'gestao'],
  [/diretor(?:a|ia)? legislativ|departamento legislativ|assessor(?:a|ia)? legislativ/i, 'Diretoria Legislativa', 'gestao'],
  [/controlador|controle interno/i, 'Controle Interno', 'gestao'],
  [/advogad[oa]|assessor(?:a|ia)? jur[íi]dic[oa]/i, 'Advogado(a) / Jurídico', 'gestao'],
  [/procurador|jur[íi]dic/i, 'Procuradoria / Jurídico', 'gestao'],
  [/recursos humanos|\bRH\b|departamento de pessoal|gest[ãa]o de pessoas/i, 'Recursos Humanos', 'gestao'],
  [/oficial administrativ|assistente administrativ|auxiliar administrativ|t[ée]cnico administrativ|agente administrativ/i, 'Administração', 'gestao'],
  [/assessor[a]?\s+parlamentar|chefe de gabinete/i, 'Assessoria Parlamentar', 'parlamentar'],
  [/ouvidor/i, 'Ouvidoria', 'atendimento'],
  [/protocolo|recep[çc][ãa]o|atendimento|telefonista|recepcionista/i, 'Protocolo e Atendimento', 'atendimento'],
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

const NOT_NAME = /@|\d|telefone|e-?mail|contato|endere[çc]o|c[âa]mara|munic[íi]p|gabinete|hor[áa]rio|atendimento|fale conosco|clique|saiba|mais|ver |leia|partido|mandato|legislatura|ramal|whats|fax|perfil|biografia|vereadores|servidores|setor|departamento|diretoria|controladoria|coordenadoria|assessoria|procuradoria|secretaria|subsecretaria|superintend[êe]ncia|presid[êe]ncia|composi[çc][ãa]o|fun[çc][õo]es|mesa diretora|chefia|divis[ãa]o|se[çc][ãa]o|diretor(?:ia)?\s+(?:geral|administrativ|legislativ|financeir)|comiss|quadro funcional|carga hor[áa]ria|servidor|efetivo|inativo|estado do|paran[áa]|licita[çc]|transpar[êe]ncia|ouvidoria|menu|principal|pesquisa|sess[õo]es|den[úu]ncia|an[ôo]nim|n[ãa]o informado|via:|portal\b|relat[óo]rio|formul[áa]rio|acompanhamento|solicita[çc][ãa]o|compet[êe]ncia|responsabilidade|organograma|departamentos|\bfonte\b|download|arquivos?\b|atribui[çc]|conhe[çc]a|acessibilidade|contraste|navega[çc]|cookies?|pol[íi]tica|\btermos?\b|aceito|enviar|voltar|retornar|imprimir|compartilh|aumentar|diminuir|not[íi]cias?|galeria|publica[çc]|portarias?|decretos?|resolu[çc]|\bleis?\b|regimento|ementa|legisla[çc]|atas?\b|pautas?\b|audi[êe]ncias?|editais|contratos?|julgamento|moç[õo]es|p[áa]gina|inicial|buscar?\b|integrantes|parlamentares|atua[çc][ãa]o|mesa\b|inverter|\bcores\b|libras|alto contraste|mapa do site|acesso\b|informa[çc][ãa]o|exportar|ex[- ]vereador/i;

export function plausibleName(value) {
  let v = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s\-–•:*]+/, '')
    .replace(/^(?:respons[áa]vel|titular|nome)\s*:\s*/i, '')
    // "Fulano - Fulano - PSD" (nome parlamentar repetido) → "Fulano - PSD"
    .replace(/^(.{5,60}?)\s+[-–]\s+\1(?=\s|$)/, '$1')
    .replace(/^(?:gabinete\s+d[oa]s?\s+)?(?:vereador[a]?|ver\.|presidente|[12][ºo°]?\s*vice[- ]?presidente|vice[- ]?presidente|[12][ºo°]?\s*secret[áa]ri[oa]|membro|relator[a]?|suplente|titular|dr\.?|dra\.?|sr\.?|sra\.?|exmo\.?\s*sr\.?[ºo°]?|ilma\.?\s*sr\.?[ªa]?)\s*[:\-–]?\s+/i, '')
    .replace(/\s+(?:-\s*)?(?:presidente|[12][ºo°]?\s*vice[- ]?presidente|vice[- ]?presidente|[12][ºo°]?\s*secret[áa]ri[oa]|membro|relator[a]?|suplente|titular)$/i, '');
  // Partido e apelido no fim podem vir juntos: "Fulano (Pato) - PP".
  v = v.replace(/\.+$/, '');
  for (let i = 0; i < 2; i++) {
    v = v.replace(/(?:\s*\([a-zà-ÿ\s'’./-]{2,35}\)|(?:\s+[-–]\s*|\s+)(?:mdb|psd|pp|pl|pt|psdb|uniao brasil|união brasil|uni[ãa]o|podemos|republicanos|psb|pdt|cidadania|solidariedade|avante|prd|novo|psol|pcdob|pv|rede|agir|dc|pmb|ptb|pros|psc|patriota|mobiliza)\.?)$/i, '').trim();
  }
  v = v
    .replace(/[\s\-–•:]+$/, '')
    .trim();
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
  const cleaned = String(text || '').replace(/\s+(?:Telefones?|Fones?|E-?mails?|Ramal|Endere[çc]o|Hor[áa]rio|WhatsApp)\b[\s\S]*$/i, '');
  const m = /(?:vereador[a]?|presidente|diretor[a]?(?: geral)?|secret[áa]ri[oa]|advogad[oa]|contador[a]?|oficial legislativo|controlador[a]?|pregoeir[oa])\s*[:\-–]?\s*([A-ZÀ-Ý][\wÀ-ÿ'’.]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\wÀ-ÿ'’.]+){1,6})/.exec(cleaned);
  return m ? plausibleName(m[1]) : '';
}

export function detectPlatform(html, url) {
  const h = String(html || '').slice(0, 300000);
  const u = String(url || '');
  const found = [];
  if (/\/\/sapl\.|sapl3|SAPL/i.test(u + h.slice(0, 20000)) && /sapl/i.test(u)) found.push('SAPL');
  if (/portalgovApp|control_rota_vereador/i.test(h)) found.push('PortalGov (MTW)');
  if (/softcam|cloudsoftcam/i.test(h)) found.push('Softcam');
  if (/plone|portal modelo|interlegis/i.test(h)) found.push('Portal Modelo (Plone)');
  if (/wp-content|wp-includes/i.test(h)) found.push('WordPress');
  if (/joomla/i.test(h)) found.push('Joomla');
  if (/atende\.net|ipm sistemas/i.test(h)) found.push('IPM Atende.Net');
  if (/betha/i.test(h)) found.push('Betha');
  if (/portalfacil|portal f[áa]cil/i.test(h)) found.push('Portal Fácil');
  if (/instar/i.test(h)) found.push('Instar');
  if (/elotech/i.test(h)) found.push('Elotech');
  if (/ingov/i.test(h)) found.push('Ingov');
  if (/govbr|gov\.br\/ds|dsgov/i.test(h)) found.push('Padrão gov.br');
  if (/__next|_next\/static/i.test(h)) found.push('Next.js');
  const gen = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{2,60})/i.exec(h)?.[1];
  const genWord = (gen || '').trim().split(/[\s-]+/)[0].toLowerCase();
  if (gen && genWord && !found.join(' ').toLowerCase().includes(genWord)) found.push(gen.trim());
  return uniq(found).slice(0, 3).join(', ');
}

function labelled(text, label) {
  const re = new RegExp('(?:^|\\s)(?:' + label + ')\\s*:\\s*([^\\n\\r]{1,90}?)(?=\\s+(?:Nome Completo|Nome Parlamentar|Nome Pol[íi]tico|Partido|Estado Civil|Escolaridade|Naturalidade|Telefones?|E-mail|Email|Homepage|Biografia|Número do Gabinete|Gabinete|Endereço|Mandato|Data de Nascimento|Profiss[ãa]o|Situa[çc][ãa]o|You Tube|Atividades|Processo)\\b|\\s*:\\s|$)', 'i');
  return re.exec(text)?.[1]?.trim() || '';
}

/** Prepara o documento: decodifica e-mails protegidos, links de WhatsApp e remove ruído. */
export function loadDocument(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,template').remove();
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
  $('a[href*="whatsapp.com/send"], a[href*="wa.me/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = /(?:[?&]phone=|wa\.me\/)(\+?55\d{10,11}|\d{10,11})/i.exec(href);
    if (m && !/\d{4}/.test($(el).text())) $(el).append(' ' + m[1]);
  });
  $('iframe').remove();
  $('br').replaceWith(' \n ');
  // Sem separador, células e blocos vizinhos se colam ("Martins" + "diretoria@..." = "martinsdiretoria@...").
  $('td,th,tr,li,p,div,h1,h2,h3,h4,h5,h6,dt,dd,section,article,header,footer,strong,b,span,a,label,small,em,option,figcaption').each((_, el) => { $(el).append(' '); });
  return $;
}

function textOf($, el) {
  return deobfuscate($(el).text().replace(/\s+/g, ' ').trim());
}

export function phonesIn(text) {
  const s = String(text || '');
  const found = (s.match(PHONE_RE) || []).map(normalizePhone);
  // Captura segundo número encadeado que compartilha o mesmo DDD, ex.: "(043) 3556-1487 – 3556.2363"
  let m;
  CHAINED_PHONE_RE.lastIndex = 0;
  while ((m = CHAINED_PHONE_RE.exec(s))) {
    const ddd = m[1];
    const parts = m[0].replace(/^\(?0?\d{2}\)?[\s.-]*/, '').split(/\s*(?:[-–/]|e)\s*/);
    for (const p of parts) {
      const norm = normalizePhone(ddd + p.replace(/\D/g, ''));
      if (norm) found.push(norm);
    }
  }
  return uniq(found);
}

const QUADRO_ROW_RE = /^([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+(?:d[aeo]s?\s+|[A-ZÀ-Ý]\.\s*)?[A-ZÀ-Ý][a-zà-ÿ]+){1,6})\s*(?:[-–|]\s*)?(Advogad[oa](?:\s+d[oa]\s+Legislativo(?:\s+Municipal)?)?|Contador[a]?|Zelador[a]?|Oficial\s+Legislativo|Oficial\s+Administrativo|Controlador[a]?\s+Intern[oa]|Diretor[a]?(?:\s+Geral|\s+Legislativo|\s+Administrativo|\s+Financeiro)?|Procurador[a]?(?:\s+Jur[íi]dic[oa])?|Assessor[a]?\s+(?:Jur[íi]dic[oa]|Parlamentar|de\s+Imprensa|de\s+Comunica[çc][ãa]o|Legislativ[oa])|Secret[áa]ri[oa](?:\s+Executiv[oa]|\s+Geral|\s+Legislativ[oa])?|Auxiliar\s+(?:Administrativo|de\s+Servi[çc]os\s+Gerais|Legislativo|Cont[áa]bil)|Assistente\s+(?:Administrativo|Legislativo)|T[ée]cnico\s+(?:em\s+Contabilidade|Legislativo|Administrativo|em\s+Inform[áa]tica)|Agente\s+(?:de\s+Contrata[çc][ãa]o|Legislativo|Administrativo)|Pregoeir[oa]|Presidente\s+da\s+(?:CPL|Comiss[ãa]o(?:\s+Permanente)?\s+de\s+Licita[çc][ãa]o)|Membro\s+da\s+CPL|Ouvidor[a]?|Recepcionista|Telefonista|Motorista|Tesoureir[oa])\b/i;

/** Extrai registros de contato de uma página HTML. */
export function extractContacts(html, url, ctx = {}) {
  const $ = loadDocument(html);
  const records = [];
  // Antes de remover <nav>, extrai itens de submenu estruturados (ex.: Softcam /ajax/header_menu/Vereadores).
  const submenuCards = [];
  $('.list-submenu-item, .item-submenu li').each((_, li) => {
    const a = $(li).find('a[href*="/camara/membros/show/"]').first();
    if (!a.length) return;
    const href = a.attr('href') || '';
    let link = url;
    try { link = new URL(href, url).href; } catch {}
    const titleRole = $(li).find('.list-title-avatar, h4').first().text().trim();
    const descName = $(li).find('.list-description').first().text().trim();
    const rawName = descName || a.text().trim();
    const name = plausibleName(rawName);
    if (!name) return;
    if (titleRole) {
      const { role, sector } = detectRole(titleRole);
      submenuCards.push({
        name,
        role: (role || titleRole) + ' (Mesa Diretora)',
        sector: /^presidente$/i.test(role || titleRole) ? 'decisor' : (sector || 'mesa'),
        source: link,
      });
    } else {
      submenuCards.push({ name, role: 'Vereador(a)', sector: 'parlamentar', source: link });
    }
  });

  $('nav').remove();
  const fullText = textOf($, 'body');
  const pagePhones = phonesIn(textOf($, 'footer') || '');
  const allPagePhones = phonesIn(fullText);
  const defaultPhone = (pagePhones.length ? pagePhones : allPagePhones).slice(0, 2).join(' / ') || ctx.fallbackPhone || '';
  const defaultEmail = cleanEmail((fullText.match(EMAIL_RE) || [])[0]) || ctx.fallbackEmail || '';

  for (const sc of submenuCards) {
    if (!defaultEmail && !defaultPhone) continue;
    const existing = records.find(r => r.name && cityKey(r.name) === cityKey(sc.name));
    if (existing) {
      if (sc.sector !== 'parlamentar' && existing.sector === 'parlamentar') {
        existing.role = sc.role;
        existing.sector = sc.sector;
      }
    } else {
      records.push({ name: sc.name, role: sc.role, sector: sc.sector, email: defaultEmail, phone: defaultPhone, source: sc.source, type: 'perfil' });
    }
  }

  // 1) Perfil individual (SAPL /parlamentar/ID, Softcam /camara/membros/show/ID ou páginas com rótulos "Nome Completo:").
  if (PROFILE_PATH.test(url) || /Nome (?:Completo|Parlamentar)\s*:/i.test(fullText)) {
    const titleName = String($('title').first().text() || '').split(/\s+[|–—-]\s+/)[0];
    const name = plausibleName(labelled(fullText, 'Nome Completo'))
      || plausibleName(labelled(fullText, 'Nome Parlamentar'))
      || plausibleName($('#vereador, .vereador-nome').first().text())
      || plausibleName($('h1').first().text())
      || plausibleName(titleName)
      || $('h1,h2,h3').toArray().map(h => plausibleName($(h).text())).find(Boolean) || '';
    const email = cleanEmail((labelled(fullText, 'E-mail|Email').match(EMAIL_RE) || [])[0]) || defaultEmail;
    const phone = phonesIn(labelled(fullText, 'Telefones?'))[0] || defaultPhone;
    let role = 'Vereador(a)', sector = 'parlamentar';
    // Detecta cargo atual na Mesa Diretora em páginas de perfil (ex.: Softcam "Em 02/01/2025, ocupou o cargo de Presidente na Mesa Diretora")
    const mesaMatch = /Em\s+\d{2}\/\d{2}\/202[5-9]\s*,\s*ocupou o cargo de\s+(Presidente|Vice-Presidente|1[ºo°]?\s*Secret[áa]ri[oa]|2[ºo°]?\s*Secret[áa]ri[oa])\s+na\s+Mesa Diretora/i.exec(fullText);
    if (mesaMatch) {
      const { role: rName, sector: rSec } = detectRole(mesaMatch[1]);
      role = (rName || mesaMatch[1]) + ' (Mesa Diretora)';
      sector = /^presidente/i.test(mesaMatch[1]) ? 'decisor' : (rSec || 'mesa');
    } else {
      const comMatch = /Em\s+\d{2}\/\d{2}\/202[5-9]\s*,\s*ocupou o cargo de\s+(Presidente)\s+na\s+(Comiss[ãa]o\s+[^.\n]+?)(?:\s+Em\s+\d{2}\/|\s+Nome Completo|$)/i.exec(fullText);
      if (comMatch) role = `Vereador(a) — Presidente da ${comMatch[2].trim()}`;
    }
    if (name && (email || phone)) {
      records.push({ name, role, sector, email, phone, source: url, type: 'perfil' });
      return records;
    }
  }

  // 2) "Cartões": para cada e-mail/telefone, sobe na árvore até um bloco com contexto suficiente.
  const pageTitle = $('h1').text().slice(0, 300) + ' ' + $('title').first().text();
  const isCouncilPage = /vereador(?:es|as)?\b|parlamentares/i.test(pageTitle) && !/ex[- ]?vereador|legislaturas|servidor|funcion/i.test(pageTitle);
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
    const cardLines = deobfuscate($(card).text()).split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const lineName = cardLines.map(plausibleName).find(Boolean) || '';
    const name = heading || lineName || nameFromText(text);
    let { role, sector } = detectRole(text);
    if (!role && name && isCouncilPage) { role = 'Vereador(a)'; sector = 'parlamentar'; }
    const phone = phonesIn(text)[0] || '';
    for (const email of emails.slice(0, 3)) {
      const byEmail = roleFromEmail(email);
      records.push({ name, role: role || byEmail.role, sector: sector || byEmail.sector, email, phone, source: url, type: name ? 'diretório' : 'setor' });
    }
  }

  // 3) Tabelas HTML de servidores/quadro funcional e listas de vereadores (mesmo quando o e-mail/telefone é centralizado na página).
  if (defaultEmail || defaultPhone) {
    $('tr').each((_, tr) => {
      const cells = $(tr).find('td').toArray().map(td => textOf($, td)).filter(Boolean);
      if (cells.length >= 2 && cells.length <= 6) {
        const nameCell = cells.map(plausibleName).find(Boolean);
        if (!nameCell || records.some(r => r.name && cityKey(r.name) === cityKey(nameCell))) return;
        const otherText = cells.filter(c => plausibleName(c) !== nameCell).join(' ');
        const { role, sector } = detectRole(otherText);
        if (!role) return;
        const rowEmail = cleanEmail((otherText.match(EMAIL_RE) || [])[0]) || defaultEmail;
        const rowPhone = phonesIn(otherText)[0] || defaultPhone;
        records.push({ name: nameCell, role, sector, email: rowEmail, phone: rowPhone, source: url, type: 'diretório' });
      }
    });

    // Células <td> que funcionam como cartões individuais de Mesa Diretora / Vereadores (ex.: cmdc.rj.gov.br)
    const isMemberPage = /vereador|parlamentar|mesa[- ]?diretora|composi[çc][ãa]o da mesa/i.test(url + ' ' + $('h1,h2,title').text());
    if (isMemberPage && !/legislaturas|mesasdiretoras/i.test(url)) {
      $('td').each((_, td) => {
        if ($(td).find('td').length) return;
        const tdLines = deobfuscate($(td).text()).split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (!tdLines.length || tdLines.length > 8) return;
        const name = tdLines.map(plausibleName).find(Boolean);
        if (!name || records.some(r => r.name && cityKey(r.name) === cityKey(name))) return;
        const tdText = tdLines.join(' ');
        let { role, sector } = detectRole(tdText);
        if (!role && /vereador/i.test(url + ' ' + $('h1,h2').text())) {
          role = 'Vereador(a)';
          sector = 'parlamentar';
        }
        if (!role) return;
        const aHref = $(td).find('a[href]').first().attr('href') || '';
        let sourceUrl = url;
        if (aHref && !/^(mailto|tel|javascript|#)/i.test(aHref)) {
          try { sourceUrl = new URL(aHref, url).href; } catch {}
        }
        records.push({ name, role, sector, email: defaultEmail, phone: defaultPhone, source: sourceUrl, type: 'diretório' });
      });
    }

    // Cartões "cargo + nome" sem e-mail próprio (ex.: "Presidente / SERGIO MESQUITA DE OLIVEIRA" em páginas de Mesa Diretora).
    const isMesaPage = /mesa[- ]?diretora|composi[çc][ãa]o da mesa|integrantes .{0,20}mesa/i.test(url + ' ' + $('h1,h2,h3,title').text() + ' ' + fullText.slice(0, 4000));
    if ((isMesaPage || isCouncilPage) && !/legislaturas|mesasdiretoras|noticia|idnot/i.test(url)) {
      const lines = [];
      $('body').find('*').contents().each((_, n) => {
        if (n.type !== 'text') return;
        const t = deobfuscate(String(n.data || '')).replace(/\s+/g, ' ').trim();
        if (t) lines.push(t);
      });
      const MESA_LINE = /^(?:\d[ºo°ª]?\s*)?(?:presidente|vice[- ]?presidente|secret[áa]ri[oa]|tesoureir[oa])(?:\s+(?:geral|da mesa))?\s*:?$/i;
      const roleIdx = lines.map((l, i) => MESA_LINE.test(l) ? i : -1).filter(i => i >= 0);
      // Orientação do cartão: nome antes do cargo ("Fulano - PSD / PRESIDENTE") ou depois ("Presidente / FULANO").
      const before = roleIdx.map(i => plausibleName(lines[i - 1] || ''));
      const after = roleIdx.map(i => plausibleName(lines[i + 1] || ''));
      const nB = before.filter(Boolean).length, nA = after.filter(Boolean).length;
      const useBefore = nB > nA || (nB === nA && !!before[0] && !after[after.length - 1]);
      const found = [];
      roleIdx.forEach((i, k) => {
        const name = useBefore ? before[k] : after[k];
        if (name) found.push({ name, label: lines[i].replace(/:$/, '') });
      });
      if (found.length >= 2) {
        for (const f of found) {
          const { role: baseRole, sector } = detectRole(f.label);
          const ord = /^(\d)/.exec(f.label)?.[1];
          const role = baseRole === 'Vice-Presidente' && ord ? `${ord}º Vice-Presidente` : baseRole;
          const existing = records.find(r => r.name && cityKey(r.name) === cityKey(f.name));
          const roleLabel = (role || f.label) + ' (Mesa Diretora)';
          const sec = role === 'Presidente' ? 'decisor' : (sector || 'mesa');
          if (existing) { existing.role = roleLabel; existing.sector = sec; continue; }
          records.push({ name: f.name, role: roleLabel, sector: sec, email: defaultEmail, phone: defaultPhone, source: url, type: 'diretório' });
        }
      }
    }

    // Linhas de Quadro Funcional (PDFs ou tabelas colapsadas em linhas de texto)
    const rawLines = ($('.pdf-document, pre').text() || $( 'body').text()).split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const m = QUADRO_ROW_RE.exec(line);
      if (m) {
        const name = plausibleName(m[1]);
        const rawCargo = m[2].trim();
        const { role, sector } = detectRole(rawCargo);
        if (name && role && !records.some(r => r.name && cityKey(r.name) === cityKey(name))) {
          records.push({
            name,
            role: rawCargo.length <= 35 ? rawCargo : role,
            sector: sector || 'gestao',
            email: defaultEmail,
            phone: defaultPhone,
            source: url,
            type: 'diretório',
          });
        }
      }
    }

    // Links para perfis de vereadores em páginas de listagem (Softcam, WordPress /vereador/slug, IPM, ?idver=).
    if (!/legislaturas|comissoes|mesasdiretoras|ex-?vereador/i.test(url)) {
      $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        let link = url;
        try { link = new URL(href, url).href; } catch { return; }
        if (!PROFILE_PATH.test(new URL(link).pathname + new URL(link).search) || link.replace(/\/$/, '') === url.replace(/\/$/, '')) return;
        const text = textOf($, a);
        if (/suplente|licenciad/i.test(text)) return;
        const fromText = text.split(/\(|\bMandato\b|\bVotos?\b|\bPartido\b/i)[0];
        const alt = ($(a).find('img').attr('alt') || $(a).attr('title') || '').replace(/^(?:foto(?:\s+d[oa])?\s+)?(?:vereador[a]?\s+)?/i, '');
        const slug = (/\/vereador(?:a|es)?\/([a-z0-9-]+)\/?$/i.exec(new URL(link).pathname) || [])[1] || '';
        const fromSlug = slug && !/^\d+$/.test(slug) ? slug.replace(/-/g, ' ').replace(/(^|\s)(\S)/g, (m, s, c) => s + c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, w => w.toLowerCase()) : '';
        const name = plausibleName(fromText) || plausibleName(alt) || plausibleName(fromSlug);
        if (!name || records.some(r => r.name && cityKey(r.name) === cityKey(name))) return;
        records.push({
          name,
          role: 'Vereador(a)',
          sector: 'parlamentar',
          email: defaultEmail,
          phone: defaultPhone,
          source: link,
          type: 'perfil',
        });
      });
    }
    // Listas "Nome / Partido: X" em páginas de vereadores (ex.: WordPress de Mallet).
    if (isCouncilPage || isMesaPage) {
      const plain = [];
      $('body').find('*').contents().each((_, n) => { if (n.type === 'text') { const t = String(n.data || '').replace(/\s+/g, ' ').trim(); if (t) plain.push(t); } });
      for (let i = 0; i < plain.length - 1; i++) {
        const next = plain[i + 1], next2 = plain[i + 2] || '';
        if (!/^partido\s*:?/i.test(next) && !/^partido\s*:?/i.test(next2)) continue;
        const name = plausibleName(plain[i]);
        if (!name || records.some(r => r.name && cityKey(r.name) === cityKey(name))) continue;
        records.push({ name, role: 'Vereador(a)', sector: 'parlamentar', email: defaultEmail, phone: defaultPhone, source: url, type: 'diretório' });
      }
    }
  }

  // 4) E-mails soltos (rodapé, páginas "Contato"): contato institucional por setor.
  const pagePhone = (pagePhones.length ? pagePhones : allPagePhones).slice(0, 2).join(' / ') || '';
  for (const raw of uniq(fullText.match(EMAIL_RE) || []).slice(0, 40)) {
    const email = cleanEmail(raw);
    if (!email || records.some(r => r.email === email && !r.name)) continue;
    // Se já há um contato com nome usando este e-mail exclusivo, não cria duplicata genérica, exceto se for o e-mail institucional geral.
    const { role, sector } = roleFromEmail(email);
    if (records.some(r => r.email === email) && sector !== 'institucional' && emailKind(email, []) !== 'pessoal/gratuito') continue;
    records.push({ name: '', role: role || 'Contato institucional', sector: sector || 'institucional', email, phone: pagePhone, source: url, type: 'geral' });
  }
  if (!records.length && pagePhone) records.push({ name: '', role: 'Telefone institucional', sector: 'institucional', email: '', phone: pagePhone, source: url, type: 'geral' });
  return records;
}

const RELEVANT = [
  [/\/parlamentar\/\d+|\/camara\/membros\/show\/\d+|\/ajax\/header_menu\/(?:Vereadores|A-Camara|Atendimento)/i, 6],
  [/quadro[- ]?funcional|telefones?(?:-|\s)?[uú]teis|ramais|lista[- ]de[- ]contatos|quem[- ]?[ée][- ]?quem|agenda[- ]telef/i, 6],
  [/vereador|parlamentar|composi[çc][ãa]o|bancada|\/camara\/membros\/exercicio/i, 5],
  [/mesa[- ]?diretora|presid[êe]ncia|\bestrutura\b|organograma|sitemap|mapa[- ]do[- ]site/i, 5],
  [/fale[- ]conosco|contatos?\b|atendimento|ouvidoria|\bsic\b/i, 4],
  [/servidores|diretoria|setores|departamentos|equipe|gabinetes/i, 4],
  [/licita[çc]|pregoeir|compras|comiss[ãa]o de contrata/i, 2],
  [/institucional|a[- ]c[âa]mara|sobre/i, 2],
];
const EXCLUDE = /noticia|news|idnot\b|idnoticia|[?&]not=|galeria|foto|video|evento|agenda(?![- ]telef)|legisla[çc][ãa]o|legislaturas|mesasdiretoras|\/comissoes\/|\/leis?\b|lei[- ]organica|regimento[- ]interno|reembolso|ajuda[- ]de[- ]custo|diarias|orcamento|ppa|ldo|loa|notas[- ]fiscais|julgamentos|emendas|indicacoes|requerimentos|projetos|tramitac|materia|proposi|sess[ãa]o|sessoes|pauta|\/ata|diario|publica[çc]|\/softcam\/|\/relatorios|\/formulario|\/acompanhamento|\/imprensa\/licitacoes|login|cidadao|vision|acessibilidade|politicadeprivacidade|dadosabertos|acesso|calend|feed|rss|busca|search|\?page=|print|imprimir|download|\.(png|jpe?g|gif|svg|css|js|zip|rar|docx?|xlsx?|pptx?|mp[34]|odt)(\?|$)/i;
const PDF_ALLOWED_CONTEXT = /quadro[- ]?funcional|organograma|servidor|estrutura|cargo|telefone|ramais|contato|mesa[- ]?diretora|comiss[ãa]o|portaria|parecer/i;

/** Links relevantes, avaliados por href E texto do âncora (além de iframes de documentos institucionais), ordenados por prioridade. */
export function relevantLinks(html, base, inScope) {
  const $ = cheerio.load(html);
  const out = new Map();
  const baseIsInstitutional = /quadro[- ]?funcional|organograma|servidor|estrutura|cargo|telefone|contato/i.test(base);
  // <base href> muda a resolução de links relativos (ex.: IPM "inst/men/5/" → sem duplicar o caminho).
  let linkBase = base;
  try { const b = $('base[href]').attr('href'); if (b) linkBase = new URL(b, base).href; } catch {}

  $('a[href], iframe[src], embed[src], object[data]').each((_, el) => {
    const isEmbed = !$(el).is('a');
    const href = $(el).attr('href') || $(el).attr('src') || $(el).attr('data') || '';
    if (/^(mailto|tel|javascript):|^#/i.test(href)) return;
    let u;
    try { u = new URL(href.trim(), linkBase); } catch { return; }
    u.hash = '';
    const isPdf = /\.pdf(\?|$)/i.test(u.pathname);
    const isTrustedStorage = /cloudsoftcam\.com\.br/i.test(u.hostname);
    if (!inScope(u) && !(isPdf && isTrustedStorage && baseIsInstitutional)) return;
    // Cartões só com foto: usa class, title e alt da imagem como rótulo.
    const label = ($(el).text() + ' ' + ($(el).attr('title') || '') + ' ' + ($(el).attr('class') || '') + ' ' + ($(el).find('img').attr('alt') || '')).replace(/\s+/g, ' ').trim().slice(0, 160);
    const hay = decodeURIComponent(u.pathname + ' ' + u.search) + ' ' + label;
    // Nomes de parâmetros de rota (?sessao=, ?pag=, ?meio=) não dizem nada sobre o conteúdo.
    const routeOnly = (u.pathname + u.search).replace(/([?&])(?:sessao|pag|pagina|page_id|meio|mod|secao|menu)=/gi, '$1');

    if (isPdf) {
      if (isEmbed && baseIsInstitutional) {
        out.set(u.href, 6);
      } else if (PDF_ALLOWED_CONTEXT.test(hay) && baseIsInstitutional) {
        out.set(u.href, 5);
      }
      return;
    }

    if (EXCLUDE.test(routeOnly) && !PROFILE_PATH.test(u.pathname + u.search)) return;
    let score = 0;
    for (const [re, s] of RELEVANT) if (re.test(hay)) score = Math.max(score, s);
    if (PROFILE_PATH.test(u.pathname + u.search)) score = Math.max(score, 6);
    if (!score) return;
    const prev = out.get(u.href);
    if (!prev || prev < score) out.set(u.href, score);
  });
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([url, score]) => ({ url, score }));
}

/** Página individual de vereador (SAPL, Softcam, WordPress /vereador/slug, IPM /portal-do-vereador/vereador/ID...). */
export const PROFILE_PATH = /\/parlamentar\/\d+|\/camara\/membros\/show\/\d+|\/vereador(?:a|es)?\/(?!page\/)[a-z0-9][a-z0-9-]{2,}\/?$|\/portal-do-vereador\/vereador\/\d+|[?&]id(?:ver|vereador|parlamentar)=\d+/i;

/** Confiança 0–100 do contato, com rótulo. */
export function scoreContact(c, officialHosts) {
  const kind = emailKind(c.email, officialHosts);
  let s = 0;
  if (kind === 'oficial') s += 35; else if (kind === 'governamental') s += 20; else if (kind === 'pessoal/gratuito') s += 12; else if (c.email) s += 8;
  if (c.name) s += 25;
  if (c.role && !/^Contato institucional$|^Telefone institucional$/.test(c.role)) s += 15;
  if (c.phone) s += 10;
  if (['api-sapl', 'perfil', 'diretório', 'cadastro-interlegis', 'cadastro-autoridades', 'manual', 'ato-oficial'].includes(c.type)) s += 15;
  s = Math.min(100, s);
  return { emailKind: kind, confidence: s, confidenceLabel: s >= 70 ? 'alta' : s >= 45 ? 'média' : 'baixa', priority: SECTOR_PRIORITY[c.sector || ''] || 0 };
}

/** Deduplica por e-mail (ou nome+telefone), mantendo o registro mais completo e preservando servidores/vereadores que compartilham o e-mail geral da Câmara. */
export function mergeContacts(items, officialHosts = []) {
  // Identifica e-mails compartilhados por múltiplas pessoas distintas (ex.: camaraabatia@gmail.com usado por todos os servidores/vereadores).
  const namesByEmail = new Map();
  for (const c of items) {
    if (c.email && c.name) {
      const set = namesByEmail.get(c.email) || new Set();
      set.add(cityKey(c.name));
      namesByEmail.set(c.email, set);
    }
  }
  const sharedEmails = new Set(
    [...namesByEmail.entries()].filter(([, names]) => names.size > 1).map(([email]) => email)
  );

  const map = new Map();
  const richness = x => (x.name ? 4 : 0) + (x.email ? 2 : 0) + (x.phone ? 2 : 0) + (x.role && x.sector !== 'institucional' ? 2 : 0) + (['perfil', 'api-sapl', 'diretório', 'ato-oficial'].includes(x.type) ? 3 : 0);
  for (const c of items) {
    if (!c.email && !c.phone) continue;
    let key;
    if (c.email && sharedEmails.has(c.email)) {
      key = c.name ? 'n:' + cityKey(c.name) : 'e:' + c.email;
    } else {
      key = c.email ? 'e:' + c.email : c.name ? 'n:' + cityKey(c.name) : 'p:' + c.phone;
    }
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...c }); continue; }
    const [best, other] = richness(c) > richness(cur) ? [{ ...c }, cur] : [cur, c];
    best.name ||= other.name; best.phone ||= other.phone; best.email ||= other.email;
    if (!best.role || best.sector === 'institucional' || (best.sector === 'parlamentar' && other.sector && other.sector !== 'parlamentar' && other.sector !== 'institucional')) {
      if (other.role && other.sector !== 'institucional') { best.role = other.role; best.sector = other.sector; }
    }
    map.set(key, best);
  }
  // Registro só com telefone (sem nome e sem e-mail) é descartado se o número já aparece em outro contato com e-mail.
  let values = [...map.values()];
  // Mesma pessoa em dois registros (cargo com e-mail geral da Câmara + e-mail pessoal sem cargo): consolida em um só,
  // preferindo e-mail/telefone próprios e o cargo mais informativo.
  const byName = new Map();
  for (const c of values) if (c.name) { const k = cityKey(c.name); (byName.get(k) || byName.set(k, []).get(k)).push(c); }
  const drop = new Set();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const own = group.filter(c => c.email && !sharedEmails.has(c.email));
    const base = own[0] || group[0];
    for (const other of group) {
      if (other === base) continue;
      // Duas pessoas homônimas com e-mails próprios distintos: mantém ambos.
      if (own.includes(other)) continue;
      const roleRank = r => (!r.role || r.sector === 'institucional') ? 0 : r.sector === 'parlamentar' ? 1 : 2;
      if (roleRank(other) > roleRank(base)) { base.role = other.role; base.sector = other.sector; }
      if (!base.phone || (sharedEmails.has(base.email) && other.phone)) base.phone ||= other.phone;
      base.email ||= other.email;
      drop.add(other);
    }
  }
  values = values.filter(c => !drop.has(c));
  // E-mail pessoal que "é" o nome oficial (valdirenedasilvaleal@gmail.com ↔ Valdirene da Silva Leal): liga o e-mail ao registro com cargo.
  const compact = s => cityKey(String(s || '').replace(/\b(?:de|da|do|das|dos|e)\b/gi, ' '));
  const withRole = values.filter(c => c.name && c.role && c.sector !== 'institucional' && (!c.email || sharedEmails.has(c.email)));
  for (const e of values) {
    if (drop.has(e) || !e.email || sharedEmails.has(e.email) || (e.role && e.sector !== 'institucional' && e.sector !== 'parlamentar')) continue;
    const local = e.email.split('@')[0].replace(/[^a-z]/g, '');
    if (local.length < 8) continue;
    const target = withRole.find(r => r !== e && compact(r.name).length >= 8 && (local === compact(r.name) || local === cityKey(r.name)));
    if (!target) continue;
    target.email = e.email;
    target.phone ||= e.phone;
    drop.add(e);
  }
  values = values.filter(c => !drop.has(c));
  const phonesWithEmail = new Set(values.filter(c => c.email).flatMap(c => String(c.phone).split(' / ')));
  return values.filter(c => c.email || c.name || !String(c.phone).split(' / ').every(p => phonesWithEmail.has(p)))
    .map(c => ({ ...c, ...scoreContact(c, officialHosts) }))
    .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || (a.name || '~').localeCompare(b.name || '~', 'pt-BR'));
}

/**
 * Extração para texto colado (sem HTML): cada e-mail usa as linhas vizinhas como "cartão",
 * sem atravessar a linha de outro e-mail, e também reconhece tabelas de Quadro Funcional coladas.
 */
export function extractFromText(text, source) {
  const lines = deobfuscate(String(text)).replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const emailsOf = l => uniq((l.match(EMAIL_RE) || []).map(cleanEmail));
  const allEmails = uniq(lines.flatMap(emailsOf));
  const allPhones = phonesIn(lines.join(' '));
  const fallbackEmail = allEmails[0] || '';
  const fallbackPhone = allPhones.slice(0, 2).join(' / ') || '';
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

  // Também extrai linhas de Quadro Funcional coladas ("Nome do Servidor   Cargo   Carga Horária")
  for (const line of lines) {
    const m = QUADRO_ROW_RE.exec(line);
    if (!m) continue;
    const name = plausibleName(m[1]);
    const rawCargo = m[2].trim();
    const { role, sector } = detectRole(rawCargo);
    if (name && role && !records.some(r => r.name && cityKey(r.name) === cityKey(name))) {
      records.push({ name, role: rawCargo, sector: sector || 'gestao', email: fallbackEmail, phone: fallbackPhone, source, type: 'manual' });
    }
  }

  if (!records.length) for (const phone of allPhones.slice(0, 5)) records.push({ name: '', role: 'Telefone', sector: 'institucional', email: '', phone, source, type: 'manual' });
  return records;
}
