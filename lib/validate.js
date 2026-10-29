import { cityKey, cleanEmail, stripAccents } from './text.js';
import { hostAffinity, hostLabel } from './identity.js';

// Validação do vínculo de cada contato com a Câmara pesquisada e higienização (um registro por e-mail na mesma Câmara).

export const VALIDATION = { VALIDADO: 'VALIDADO', SUSPEITO: 'SUSPEITO', NAO_VALIDADO: 'NAO_VALIDADO', ORGAO_EXTERNO: 'ORGAO_EXTERNO' };

const FREE_MAIL = /@(?:gmail|googlemail|hotmail|outlook|live|yahoo|ymail|bol|uol|terra|ig|globo|globomail|msn|icloud|me|zipmail|r7|protonmail)\.(?:com|com\.br|br)$/i;
const UFS = new Set(['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to']);
// Órgãos que não são a Câmara: tribunais, MP, assembleias, Senado, órgãos estaduais/federais, associações e consórcios.
const EXTERNAL_LABEL = /^(?:tce|tcu|tcm|tc|mp|mppr|mpf|mpt|mpe|tj|tjpr|tre|trt\d*|trf\d*|tse|stf|stj|alep|al|assembleia|senado|planalto|receita|fazenda|sefa|sefaz|caixa|bb|correios|ibge|cgu|agu|pf|prf|pm|pmpr|policia|detran|sesa|saude|seed|educacao|celepar|cge|casacivil|pncp|interlegis|sebrae|senac|senai|uvepar|amp|ampr|cnm|ipardes|copel|sanepar|tecpar|iap|iat|adapar|emater|idr|der|defensoria|oab|crea|crc|cra|conselho|consorcio|associacao|sindicato|cidadao)$/;

export function emailDomain(email) {
  return (cleanEmail(email).split('@')[1] || '').toLowerCase();
}

/** Órgão externo pelo domínio: tribunais, MP, Senado, Câmara dos Deputados, órgãos federais (sem UF) ou estaduais. */
export function externalInstitution(domain) {
  const d = String(domain || '').toLowerCase();
  if (!d) return '';
  if (/(^|\.)camara\.leg\.br$|(^|\.)senado\.(leg|gov)\.br$/.test(d)) return 'Congresso Nacional';
  const parts = d.split('.');
  const first = parts[0];
  if (/\.(gov|leg|jus|mp|def)\.br$/.test(d)) {
    if (/\.jus\.br$/.test(d)) return 'Poder Judiciário';
    if (/\.mp\.br$/.test(d)) return 'Ministério Público';
    if (/\.def\.br$/.test(d)) return 'Defensoria Pública';
    const uf = parts.length >= 3 ? parts[parts.length - 3] : '';
    // Órgão federal: dominio.gov.br sem a sigla do estado.
    if (/\.gov\.br$/.test(d) && !UFS.has(uf)) return 'órgão federal';
    if (EXTERNAL_LABEL.test(first)) return 'órgão estadual/externo (' + first + ')';
    // Domínio estadual direto (ex.: pr.gov.br, aen.pr.gov.br) com rótulo de secretaria/órgão.
    if (UFS.has(first)) return 'governo estadual';
  } else if (EXTERNAL_LABEL.test(first) || /associacao|consorcio|sindicato|federacao|confederacao/.test(d)) {
    return 'entidade externa (' + first + ')';
  }
  return '';
}

/** E-mail de Prefeitura (domínio "pm..."/"prefeitura..." ou caixa sem relação com a Câmara no domínio do município). */
function prefeituraMail(email, city, fromRegistry = false) {
  const [local, domain] = cleanEmail(email).split('@');
  if (!domain) return false;
  const { first } = hostLabel(domain);
  if (/^(?:pm|prefeitura|pref)[a-z]{3,}/.test(first)) return !/camara|legislativ|vereador/.test(local);
  // Domínio exatamente do município (ex.: matelandia.pr.gov.br) costuma ser da Prefeitura; a Câmara costuma usar caixa "camara@...".
  if (fromRegistry) return false;
  if (first === cityKey(city) && /\.gov\.br$/.test(domain)) return !/camara|legislativ|vereador|presid|cm\b|secretaria(?:camara)?|ouvidoriacamara/.test(local);
  return false;
}

const baseHost = h => String(h || '').toLowerCase().replace(/^www\d?\./, '');
const hostOf = u => { try { return baseHost(new URL(u).hostname); } catch { return ''; } };
const REGISTRY_TYPES = new Set(['cadastro-interlegis', 'cadastro-autoridades']);

/**
 * Classifica o vínculo de um contato com a Câmara pesquisada.
 * ctx: { city, uf, siteHosts: Set<string> (hosts validados do site/SAPL), siteValidated: boolean }
 * Retorna { validation, evidence: string[], reason, sourceCity }.
 */
export function classifyContact(c, ctx) {
  const evidence = [];
  const email = cleanEmail(c.email);
  const domain = emailDomain(email);
  const src = hostOf(c.source);
  const onSite = !!src && [...ctx.siteHosts].some(h => src === h || src.endsWith('.' + h));
  const fromRegistry = REGISTRY_TYPES.has(c.type);
  const fromSearch = c.type === 'busca';

  if (onSite) evidence.push(`publicado no site validado (${src})`);
  else if (fromRegistry) evidence.push(c.type === 'cadastro-interlegis' ? 'cadastro Interlegis/Senado do município' : 'cadastro estadual de autoridades');
  else if (fromSearch) evidence.push('trecho indexado por buscador');
  else if (src) evidence.push(`fonte externa (${src})`);

  // Página de origem de outro município (não deveria ocorrer após a validação do site, mas é verificada de novo).
  if (src && !onSite && !fromRegistry) {
    const pageAff = hostAffinity(src, ctx.city);
    if (pageAff.level === 'outra' && /\.(leg|gov)\.br$/.test(src)) {
      return { validation: VALIDATION.SUSPEITO, evidence, reason: `fonte pertence a outro órgão/município (${pageAff.why})`, sourceCity: '' };
    }
  }

  if (email) {
    // E-mails técnicos de terceiros (temas, plataformas, "noreply") não são contato da Câmara.
    if (/^(?:no-?reply|donotreply|do-not-reply|mailer-daemon|postmaster|wordpress|webmaster)@/i.test(email) || /(?:^|\.)(?:envato|wixpress|sentry|example|wordpress|w3|schema|godaddy|hostgator|locaweb|googlegroups)\.(?:com|org|net|com\.br)$/i.test(domain)) {
      return { validation: VALIDATION.ORGAO_EXTERNO, evidence, reason: `e-mail técnico de terceiros (${domain})`, sourceCity: '' };
    }
    const ext = externalInstitution(domain);
    if (ext) return { validation: VALIDATION.ORGAO_EXTERNO, evidence, reason: `e-mail de ${ext} (${domain})`, sourceCity: '' };
    if (prefeituraMail(email, ctx.city, fromRegistry)) return { validation: VALIDATION.ORGAO_EXTERNO, evidence, reason: `e-mail da Prefeitura (${domain}), não da Câmara`, sourceCity: '' };
    const free = FREE_MAIL.test(email);
    const ownDomain = [...ctx.siteHosts].some(h => domain === h || domain.endsWith('.' + h) || h.endsWith('.' + domain));
    let aff = 'indefinida';
    if (free) { aff = 'gratuito'; evidence.push('e-mail de provedor gratuito'); }
    else if (ownDomain) { aff = 'site'; evidence.push(`domínio do e-mail = domínio oficial (${domain})`); }
    else {
      const a = hostAffinity(domain, ctx.city);
      aff = a.level;
      if (a.level === 'propria') evidence.push(a.why.replace('domínio', 'domínio do e-mail'));
      // Só domínios públicos (.leg.br/.gov.br) com nome de outro lugar indicam outro município; .com.br próprio publicado no site é aceito.
      if (a.level === 'outra' && /\.(?:leg|gov)\.br$/.test(domain)) return { validation: VALIDATION.SUSPEITO, evidence, reason: `domínio do e-mail indica outro município/órgão (${a.why})`, sourceCity: '' };
      if (a.level === 'outra') aff = 'indefinida';
    }
    if (onSite || fromRegistry) return { validation: VALIDATION.VALIDADO, evidence, reason: '', sourceCity: ctx.city };
    if (aff === 'site' || aff === 'propria') return { validation: VALIDATION.VALIDADO, evidence, reason: '', sourceCity: ctx.city };
    return { validation: VALIDATION.NAO_VALIDADO, evidence, reason: 'vínculo com a Câmara não confirmado (fonte fora do site validado)', sourceCity: '' };
  }
  if (onSite || fromRegistry) return { validation: VALIDATION.VALIDADO, evidence, reason: '', sourceCity: ctx.city };
  return { validation: VALIDATION.NAO_VALIDADO, evidence, reason: 'telefone sem fonte institucional confirmada', sourceCity: '' };
}

/** Prioridade estratégica do cargo (maior = mais estratégico). */
export function strategicRank(c) {
  const r = stripAccents(String(c.role || '')).toLowerCase();
  let s = 0;
  if (/\bpresidente\b/.test(r) && !/vice|comiss|cpl|licita/.test(r)) s = 100;
  else if (/diretor(a)?[- ]geral|direcao geral/.test(r)) s = 90;
  else if (/diretor(a)?[- ]executiv/.test(r)) s = 85;
  else if (/secretari[oa][- ]geral|secretaria-geral/.test(r)) s = 80;
  else if (/diretor(ia|a)? administrativ/.test(r)) s = 75;
  else if (/mesa diretora|vice[- ]?presidente|[12]º? secretari/.test(r)) s = 70;
  else if (/diretor/.test(r)) s = 60;
  else if (/vereador|parlamentar/.test(r)) s = 50;
  else if (r && !/contato institucional|telefone institucional/.test(r)) s = 40;
  else s = 10;
  return s + (c.name && !c.nameGenerated ? 5 : 0) + (c.validation === VALIDATION.VALIDADO ? 2 : 0);
}

/**
 * Higienização dentro da mesma Câmara: cada e-mail fica em um único registro (o de cargo mais estratégico).
 * Outras pessoas que usavam o mesmo e-mail geral continuam na lista, com o e-mail em "sharedEmail".
 * Registros genéricos repetidos (sem nome) são descartados. Retorna { contacts, log }.
 */
export function hygiene(contacts) {
  const log = [];
  const byEmail = new Map();
  for (const c of contacts) if (c.email) (byEmail.get(c.email) || byEmail.set(c.email, []).get(c.email)).push(c);
  const drop = new Set();
  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => strategicRank(b) - strategicRank(a) || (b.confidence || 0) - (a.confidence || 0));
    const keep = sorted[0];
    for (const other of sorted.slice(1)) {
      const genericDup = !other.name || other.nameGenerated;
      if (genericDup) { drop.add(other); log.push({ email, kept: keep.name || keep.role, removed: other.role || '(genérico)', decision: 'registro genérico duplicado removido' }); continue; }
      other.sharedEmail = email;
      other.email = '';
      other.note = `e-mail institucional compartilhado; registro principal: ${keep.name || keep.role}`;
      log.push({ email, kept: keep.name || keep.role, removed: other.name, decision: 'e-mail mantido só no cargo mais estratégico; pessoa preservada sem e-mail próprio' });
    }
  }
  return { contacts: contacts.filter(c => !drop.has(c)), log };
}

/** Nome vazio → "Câmara de <Município>" (identificado como gerado; não é atribuído a pessoa). */
export function fillName(c, city) {
  if (c.name) return c;
  return { ...c, name: `Câmara de ${city}`, nameGenerated: true };
}
