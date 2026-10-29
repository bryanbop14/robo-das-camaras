import { cleanEmail } from './text.js';
import { hostAffinity } from './identity.js';

// Verificação entre municípios: um mesmo e-mail atribuído a várias Câmaras.
// Preserva vínculos comprovados, remove só os demonstravelmente errados e manda o resto para revisão — com registro da decisão.

const FREE_MAIL = /@(?:gmail|googlemail|hotmail|outlook|live|yahoo|ymail|bol|uol|terra|ig|globo|msn|icloud|zipmail|r7)\./i;
const REGISTRY_TYPES = new Set(['cadastro-interlegis', 'cadastro-autoridades']);
const baseHost = h => String(h || '').toLowerCase().replace(/^www\d?\./, '');
const hostOf = u => { try { return baseHost(new URL(u).hostname); } catch { return ''; } };

function ownHosts(r) {
  return [r.officialSite, r.saplUrl].map(hostOf).filter(Boolean);
}
const within = (host, hosts) => !!host && hosts.some(h => host === h || host.endsWith('.' + h) || h.endsWith('.' + host));

/**
 * Resultados gravados antes da validação institucional: se o site "oficial" salvo é um domínio .leg.br/.gov.br de outro
 * município (ex.: Carlópolis com www.mariopolis.pr.leg.br), os contatos dele saem da lista e vão para revisão.
 */
export function sanitizeLegacy(results) {
  const decisions = [];
  const out = results.map(r => {
    if (r.siteValidation) return r;
    const hosts = [r.officialSite, r.saplUrl].map(hostOf).filter(h => /\.(leg|gov)\.br$/.test(h));
    const foreign = hosts.find(h => hostAffinity(h, r.city).level === 'outra');
    if (!foreign) return r;
    const keep = [], moved = [];
    for (const c of r.contacts || []) {
      const src = hostOf(c.source);
      const fromForeign = src && (src === foreign || src.endsWith('.' + foreign) || foreign.endsWith('.' + src));
      const domain = cleanEmail(c.email).split('@')[1] || '';
      const domForeign = domain && !FREE_MAIL.test(c.email || '') && hostAffinity(domain, r.city).level === 'outra';
      if (fromForeign || (REGISTRY_TYPES.has(c.type) ? domForeign : !REGISTRY_TYPES.has(c.type) && !src)) moved.push({ ...c, validation: 'SUSPEITO', validationReason: `coletado em ${foreign}, site de outro município` });
      else keep.push(c);
    }
    decisions.push({ email: '(todos do site)', municipios: r.city, municipio: r.city, fonte: 'https://' + foreign, cargo: '', evidencia: 'site salvo antes da validação', motivo: `site ${foreign} não pertence a ${r.city}`, decisao: moved.length ? `removido (${moved.length} contato(s))` : 'site recusado (sem contatos dele)' });
    return { ...r, status: 'site_nao_validado', officialSite: '', saplUrl: '', contacts: keep, review: [...(r.review || []), ...moved] };
  });
  return { results: out, decisions };
}

/**
 * results: [{ id, city, officialSite, saplUrl, contacts: [...] }]
 * Retorna { results (cópias com contatos ajustados), decisions: [{ email, municipios, municipio, fonte, evidencia, motivo, decisao }] }.
 */
export function crossCheck(rawResults) {
  const legacy = sanitizeLegacy(rawResults);
  const results = legacy.results;
  const occ = new Map();
  results.forEach((r, ri) => (r.contacts || []).forEach((c, ci) => {
    const e = cleanEmail(c.email || c.sharedEmail);
    if (!e) return;
    const list = occ.get(e) || [];
    list.push({ ri, ci, r, c });
    occ.set(e, list);
  }));

  const removeKeys = new Set();
  const flags = new Map();
  const decisions = [...legacy.decisions];

  for (const [email, list] of occ) {
    const cities = [...new Set(list.map(o => o.r.city))];
    if (cities.length < 2) continue;
    const domain = email.split('@')[1] || '';
    const free = FREE_MAIL.test(email);
    const assess = list.map(o => {
      const src = hostOf(o.c.source);
      const own = ownHosts(o.r);
      const onOwnSite = within(src, own);
      const otherOwner = results.find((r2, i2) => i2 !== o.ri && cities.includes(r2.city) && within(src, ownHosts(r2)));
      const domAff = free ? 'gratuito' : hostAffinity(domain, o.r.city).level;
      const registry = REGISTRY_TYPES.has(o.c.type);
      return { ...o, src, onOwnSite, otherOwner, domAff, registry };
    });
    const domainOwners = free ? [] : assess.filter(a => a.domAff === 'propria').map(a => a.r.city);
    for (const a of assess) {
      const base = { email, municipios: cities.join(', '), municipio: a.r.city, fonte: a.c.source || '', cargo: a.c.role || '' };
      let decisao, motivo;
      const siteForeign = a.onOwnSite && /\.(leg|gov)\.br$/.test(a.src) && hostAffinity(a.src, a.r.city).level === 'outra';
      const thirdParty = !free && !/\.(gov|leg|jus|mp)\.br$/.test(domain) && !domainOwners.length && cities.length >= 2;
      if (siteForeign) {
        decisao = 'removido'; motivo = `o site ${a.src} não pertence a ${a.r.city}`;
      } else if (a.otherOwner && !a.onOwnSite) {
        decisao = 'removido'; motivo = `fonte pertence ao site validado de ${a.otherOwner.city}, não de ${a.r.city}`;
      } else if (!free && a.domAff === 'outra' && domainOwners.length && !a.onOwnSite) {
        decisao = 'removido'; motivo = `domínio do e-mail (${domain}) pertence a ${[...new Set(domainOwners)].join(', ')}; ${a.registry ? 'erro no cadastro de origem' : 'fonte sem vínculo com ' + a.r.city}`;
      } else if (thirdParty) {
        decisao = 'revisão'; motivo = `domínio de terceiro (${domain}) publicado em vários municípios — provável fornecedor/serviço, não contato da Câmara`;
      } else if (a.onOwnSite && a.domAff !== 'outra') {
        decisao = 'mantido (compartilhado)'; motivo = `publicado no site validado de ${a.r.city}`;
      } else if (a.registry && a.domAff !== 'outra') {
        decisao = 'mantido (compartilhado)'; motivo = 'cadastro oficial do município, domínio compatível';
      } else {
        decisao = 'revisão'; motivo = 'sem evidência suficiente para confirmar ou descartar o vínculo';
      }
      if (decisao === 'removido') removeKeys.add(`${a.ri}:${a.ci}`);
      else flags.set(`${a.ri}:${a.ci}`, { sharedAcross: cities.filter(c => c !== a.r.city), crossDecision: decisao, crossReason: motivo });
      decisions.push({ ...base, evidencia: a.onOwnSite ? 'site validado' : a.registry ? 'cadastro' : a.src || '—', motivo, decisao });
    }
  }

  const out = results.map((r, ri) => {
    const removed = [];
    const contacts = [];
    (r.contacts || []).forEach((c, ci) => {
      const k = `${ri}:${ci}`;
      if (removeKeys.has(k)) removed.push({ ...c, validation: 'SUSPEITO', validationReason: decisions.find(d => d.municipio === r.city && d.email === cleanEmail(c.email || c.sharedEmail) && d.decisao === 'removido')?.motivo || 'vínculo entre municípios incorreto' });
      else contacts.push(flags.has(k) ? { ...c, ...flags.get(k) } : c);
    });
    return removed.length || flags.size ? { ...r, contacts, review: [...(r.review || []), ...removed] } : r;
  });
  return { results: out, decisions };
}

/** Relatório de qualidade da varredura. */
export function qualityReport(results, decisions) {
  const sum = f => results.reduce((n, r) => n + (f(r) || 0), 0);
  const multiEmails = new Set(decisions.map(d => d.email));
  return {
    municipios: results.length,
    comSiteValidado: results.filter(r => r.officialSite || r.saplUrl).length,
    semValidacao: results.filter(r => !r.officialSite && !r.saplUrl).length,
    siteNaoValidado: results.filter(r => r.status === 'site_nao_validado').length,
    contatosExtraidos: sum(r => r.quality?.extracted ?? r.contacts.length),
    contatosValidados: sum(r => r.contacts.filter(c => c.validation === 'VALIDADO').length),
    contatosNaoValidados: sum(r => r.contacts.filter(c => c.validation === 'NAO_VALIDADO').length),
    contatosSuspeitos: sum(r => (r.review || []).filter(c => c.validation === 'SUSPEITO').length),
    orgaosExternos: sum(r => (r.review || []).filter(c => c.validation === 'ORGAO_EXTERNO').length),
    emailsDuplicadosEntreMunicipios: multiEmails.size,
    associacoesRemovidas: decisions.filter(d => d.decisao.startsWith('removido')).length,
    revisaoManual: decisions.filter(d => d.decisao === 'revisão').length + sum(r => r.contacts.filter(c => c.validation === 'NAO_VALIDADO').length),
    semContatoConfiavel: results.filter(r => !r.contacts.some(c => c.validation === 'VALIDADO')).map(r => r.city),
  };
}
