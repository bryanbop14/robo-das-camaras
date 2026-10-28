import * as cheerio from 'cheerio';
import { BLOCKED_STATUS, fetchWithFallback, resolvePublic, robotsCheck, validPublicUrl } from './net.js';
import { detectPlatform, extractContacts, mergeContacts, relevantLinks } from './extract.js';
import { collectSapl } from './sapl.js';
import { stateSources } from './official-sources.js';
import { cityKey, cleanEmail, normalizePhone, stripAccents, uniq } from './text.js';

// Domínios que não seguem o padrão do nome e não estão no cadastro Interlegis.
const KNOWN = {
  'AM:Manaus': ['https://www.cmm.am.gov.br'],
  'PA:Belém': ['https://cmb.pa.gov.br'],
  'SP:São Paulo': ['https://www.saopaulo.sp.leg.br'],
  'PE:Recife': ['https://www.recife.pe.leg.br'],
  'CE:Quixadá': ['https://camaraquixada.ce.gov.br'],
  'PR:Coronel Vivida': ['https://www.camaracoronelvivida.pr.gov.br'],
  'PR:Cruzeiro do Oeste': ['https://www.cmcruzeirodooeste.pr.gov.br'],
  'PR:Douradina': ['https://www.douradina.pr.leg.br'],
  'DF:Brasília': ['https://www.cl.df.gov.br'],
};

const GUESS_PATHS = {
  fast: ['/vereadores', '/contato', '/mesa-diretora', '/telefones-uteis'],
  full: ['/vereadores', '/parlamentares', '/processo-legislativo/vereadores', '/mesa-diretora', '/contato', '/contatos', '/fale-conosco',
    '/telefones-uteis', '/servidores', '/quem-e-quem', '/estrutura-organizacional', '/institucional', '/a-camara'],
};

const LEGISLATIVE = /c[aâ]mara (municipal|de vereadores)|poder legislativo|legislativo municipal|vereador|processo legislativo|casa de leis|c[aâ]mara legislativa/i;

/** Aceita apenas hints com cara de URL oficial (o cadastro Interlegis sempre usa .leg.br/.gov.br). */
export function sanitizeHint(hint) {
  if (!hint || typeof hint !== 'object') return null;
  const testMode = process.env.ROBO_TEST_ALLOW_LOCAL === '1' && process.env.NODE_ENV !== 'production';
  const official = v => { const u = validPublicUrl(String(v || '')); return u && (/\.(leg|gov)\.br$/i.test(u.hostname) || testMode) ? u.href.replace(/\/$/, '') : ''; };
  return {
    site: official(hint.site),
    sapl: official(hint.sapl),
    others: uniq((Array.isArray(hint.services) ? hint.services : []).map(s => official(s?.url))).slice(0, 5),
    email: cleanEmail(hint.email),
    phone: String(hint.phone || '').split('/').map(normalizePhone).filter(Boolean).slice(0, 2).join(' / '),
    cnpj: /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(hint.cnpj || '') ? hint.cnpj : '',
    address: String(hint.address || '').slice(0, 200),
    source: String(hint.registrySource || '').startsWith('https://www12.senado.leg.br/') ? hint.registrySource : 'https://www12.senado.leg.br/interlegis/orgaosatendidos',
  };
}

export function heuristicDomains(city, uf) {
  const s = cityKey(city), u = uf.toLowerCase();
  return uniq([
    ...(KNOWN[uf + ':' + city] || []),
    `https://www.${s}.${u}.leg.br`,
    `https://${s}.${u}.leg.br`,
    `https://www.camara${s}.${u}.gov.br`,
    `https://camara${s}.${u}.gov.br`,
    `https://www.cm${s}.${u}.gov.br`,
    `https://www.camarade${s}.${u}.gov.br`,
    `https://www.camaramunicipalde${s}.${u}.gov.br`,
    `https://www.cm${s}.${u}.leg.br`,
  ]);
}

async function searchDomains(city, uf) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 3500);
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `"Câmara Municipal de ${city}" ${uf} vereadores`, gl: 'br', hl: 'pt-br', num: 10 }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return uniq((data.organic || []).map(r => { try { return new URL(r.link).origin; } catch { return null; } }))
      .filter(o => !/facebook|instagram|youtube|wikipedia|google|jusbrasil|linkedin|twitter|x\.com|cidade-brasil|guiamais|apontador|cnpj/i.test(o))
      .slice(0, 4);
  } catch { return []; } finally { clearTimeout(timer); }
}

/** Espera `promise` por até `ms`; devolve `fallback` se o tempo acabar, sem deixar timer pendurado. */
function within(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise(r => { timer = setTimeout(() => r(fallback), Math.max(0, ms)); })]).finally(() => clearTimeout(timer));
}

const baseHost = host => host.toLowerCase().replace(/^www\d?\./, '');

/** Página pertence a uma Câmara (e, se não veio do cadastro oficial, à Câmara DESTE município). */
function identity(html, city, trusted) {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  const title = $('title').text() + ' ' + $('h1,h2,.logo,header,[class*=brand]').text();
  const body = $('body').text().slice(0, 20000);
  const all = title + ' ' + body;
  if (!LEGISLATIVE.test(all)) return { ok: false, reason: 'HTTP 200, conteúdo não identificado como Câmara' };
  if (/prefeitura municipal/i.test(title) && !/c[aâ]mara/i.test(title)) return { ok: false, reason: 'HTTP 200, site da Prefeitura (não da Câmara)' };
  if (!trusted && !stripAccents(all).toLowerCase().replace(/[^a-z0-9]/g, '').includes(cityKey(city))) return { ok: false, reason: 'HTTP 200, Câmara de outro município' };
  if ($('body').text().trim().length < 120 && !/http-equiv=["']?refresh|location\.href/i.test(html)) return { ok: false, reason: 'HTTP 200, página vazia (provável aplicação JavaScript)' };
  return { ok: true };
}

function describeStatus(status) {
  if (status === 'dns_inexistente') return 'domínio inexistente';
  if (status === 'tls') return 'certificado TLS inválido/incompleto';
  if (status === 'timeout') return 'servidor não respondeu a tempo';
  if (status === 'conexao') return 'conexão recusada';
  if (status === 'robots') return 'robots.txt não permite a leitura';
  if (status === 'robots_indisponivel') return 'robots.txt não respondeu (leitura suspensa por precaução)';
  if (BLOCKED_STATUS.has(Number(status))) return 'servidor bloqueou a requisição automatizada';
  return '';
}

/**
 * Varre a Câmara de um município.
 * opts: { fast, hint } — hint é o registro do cadastro Interlegis vindo do painel.
 */
export async function scanCamara(city, uf, opts = {}) {
  const fast = !!opts.fast;
  const started = Date.now();
  const deadline = started + (fast ? 24000 : 54000);
  const hint = sanitizeHint(opts.hint);
  const attempts = [];
  const records = [];
  const warnings = [];
  const log = (url, status, reason = '') => attempts.push({ url, status, reason: reason || describeStatus(status) });

  if (hint && (hint.email || hint.phone)) {
    records.push({ name: '', role: 'Contato institucional (cadastro Interlegis)', sector: 'institucional', email: hint.email, phone: hint.phone, source: hint.source, type: 'cadastro-interlegis' });
  }
  const statePromise = stateSources(city, uf).catch(() => ({ contacts: [], attempts: [] }));

  // ---------- 1. Descoberta ----------
  const fromHint = hint ? uniq([hint.site, ...hint.others].filter(u => u && u !== hint.sapl)) : [];
  const searchPromise = searchDomains(city, uf);
  let candidates = uniq([...fromHint, ...heuristicDomains(city, uf)]);
  const trusted = new Set(fromHint.map(u => new URL(u).origin).concat((KNOWN[uf + ':' + city] || [])));

  async function probe(url) {
    const u = validPublicUrl(url);
    if (!u) return { url, status: 'url_invalida' };
    const dns = await resolvePublic(u.hostname);
    if (!dns.ok) return { url, status: dns.status, quiet: !trusted.has(u.origin) };
    const rob = await robotsCheck(u.origin + '/', deadline);
    if (!rob.allowed) return { url, status: rob.reason };
    const r = await fetchWithFallback(u.origin + '/', { timeout: fast ? 7000 : 9000, deadline });
    if (r.status !== 200) return { url, status: r.status, reason: r.reason };
    const id = identity(r.html, city, trusted.has(u.origin) || trusted.has(new URL(r.url).origin));
    return id.ok ? { url, status: 200, final: r.url, html: r.html, reason: r.reason } : { url, status: 'nao_camara', reason: id.reason };
  }

  let site = null;
  const probed = [];
  const runProbes = async list => {
    const results = await Promise.all(list.map(probe));
    for (const r of results) {
      probed.push(r);
      if (!r.quiet) log(r.url, r.status, r.reason);
    }
    // Ordem de preferência: cadastro oficial > conhecidos > heurísticos > busca.
    return results.find(r => r.status === 200) || null;
  };
  // Fontes confiáveis primeiro; os padrões heurísticos só são testados se elas falharem.
  const firstWave = candidates.filter(u => trusted.has(new URL(u).origin));
  if (firstWave.length) site = await runProbes(firstWave);
  if (!site) site = await runProbes(candidates.filter(u => !firstWave.includes(u)));
  if (!site) {
    const extra = (await searchPromise).filter(o => !candidates.includes(o));
    if (extra.length && Date.now() < deadline - 8000) { candidates = candidates.concat(extra); site = await runProbes(extra); }
  }
  const quietDns = probed.filter(r => r.quiet).length;
  if (quietDns) log('(' + quietDns + ' domínios heurísticos)', 'dns_inexistente', 'padrões de domínio testados sem registro DNS');

  // ---------- 2. SAPL (em paralelo com o site) ----------
  const siteHost = site ? baseHost(new URL(site.final).hostname) : '';
  const saplCandidates = uniq([
    hint?.sapl,
    siteHost && 'https://sapl.' + siteHost,
    siteHost && /^(camara|cm)/.test(siteHost) && 'https://' + siteHost.replace(/^(camara|cm)/, 'sapl'),
    !site && hint?.site && 'https://sapl.' + baseHost(new URL(hint.site).hostname),
  ]);
  const saplPromise = (async () => {
    for (const origin of saplCandidates) {
      if (Date.now() > deadline - 6000) break;
      const u = validPublicUrl(origin);
      if (!u || !(await resolvePublic(u.hostname)).ok) continue;
      const res = await collectSapl(u.origin, deadline);
      res.attempts.forEach(a => attempts.push({ ...a, reason: a.reason || describeStatus(a.status) }));
      if (res.ok) return { ...res, origin: u.origin };
    }
    return null;
  })();

  // ---------- 3. Navegação priorizada no site ----------
  let pagesVisited = 0, platform = '', stopReason = '';
  const scopeHosts = new Set([siteHost, ...saplCandidates.map(o => { try { return baseHost(new URL(o).hostname); } catch { return ''; } })].filter(Boolean));
  const inScope = u => ['http:', 'https:'].includes(u.protocol) && [...scopeHosts].some(h => { const b = baseHost(u.hostname); return b === h || b.endsWith('.' + h); });
  const pageLimit = fast ? 14 : 60;
  const queue = [];
  const queued = new Set();
  const visited = new Set();
  const push = (url, score, depth, guess = false) => {
    let u; try { u = new URL(url); } catch { return; }
    u.hash = '';
    const key = u.href.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (queued.has(key) || !inScope(u)) return;
    queued.add(key);
    queue.push({ url: u.href, score, depth, guess });
  };

  if (site) {
    const home = site.final;
    platform = detectPlatform(site.html, home);
    visited.add(home.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    queued.add(home.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    pagesVisited++;
    records.push(...extractContacts(site.html, home));
    for (const l of relevantLinks(site.html, home, inScope)) push(l.url, l.score, 1);
    const origin = new URL(home).origin;
    for (const p of GUESS_PATHS[fast ? 'fast' : 'full']) push(origin + p, 3, 1, true);
  }

  const sapl = await within(saplPromise, 50, 'pending');
  const profileRoles = new Map();
  const applySapl = s => {
    if (!s || s === 'pending') return;
    records.push(...s.records);
    for (const l of s.profileLinks) { push(l.url, l.score, 1); if (l.role) profileRoles.set(l.url.replace(/\/$/, ''), l); }
  };
  applySapl(sapl);
  let saplResult = sapl === 'pending' ? null : sapl;

  const CONCURRENCY = 6;
  while (true) {
    if (!saplResult) {
      // Sem páginas na fila, espera o SAPL (que pode trazer perfis para visitar); senão, só verifica.
      const waitMs = Math.max(0, deadline - Date.now() - 2500);
      const s = queue.length
        ? await Promise.race([saplPromise, Promise.resolve('pending')])
        : await within(saplPromise, waitMs, null);
      if (s !== 'pending') { saplResult = s || { records: [], ok: false }; applySapl(s); }
    }
    if (!queue.length) break;
    if (pagesVisited >= pageLimit) { stopReason = 'limite de páginas'; break; }
    if (Date.now() > deadline - 2500) { stopReason = 'limite de tempo'; break; }
    queue.sort((a, b) => b.score - a.score || a.depth - b.depth);
    // No modo rápido, para quando só restarem páginas de baixa relevância e já houver contatos.
    if (fast && queue[0].score < 4 && records.some(r => r.name)) break;
    const batch = queue.splice(0, Math.min(CONCURRENCY, pageLimit - pagesVisited));
    const pages = await Promise.all(batch.map(async e => {
      const key = e.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (visited.has(key)) return null;
      visited.add(key);
      const rob = await robotsCheck(e.url, deadline);
      if (!rob.allowed) return { ...e, status: rob.reason };
      return { ...e, ...(await fetchWithFallback(e.url, { timeout: fast ? 6000 : 8000, deadline })) };
    }));
    for (const page of pages.filter(Boolean)) {
      if (page.status !== 200 || !page.html) {
        if (!(page.guess && [404, 410].includes(page.status))) log(page.url, page.status, page.reason);
        continue;
      }
      pagesVisited++;
      const known = profileRoles.get(page.url.replace(/\/$/, ''));
      const found = extractContacts(page.html, page.url);
      // Cargo da Mesa vindo da API do SAPL prevalece sobre o "Vereador(a)" genérico do perfil.
      if (known) for (const c of found) if (c.type === 'perfil') { c.role = known.role; c.sector = known.sector; }
      records.push(...found);
      if (page.depth < 3) for (const l of relevantLinks(page.html, page.url, inScope)) push(l.url, Math.max(1, l.score - (page.depth >= 2 ? 1 : 0)), page.depth + 1);
    }
  }
  if (!saplResult) {
    const remaining = deadline - Date.now();
    const s = remaining > 1000 ? await within(saplPromise, remaining - 800, null) : null;
    if (s) { saplResult = s; records.push(...s.records); }
  }
  const saplOk = !!saplResult?.ok;

  const state = await statePromise;
  records.push(...state.contacts);
  attempts.push(...state.attempts);

  // ---------- 4. Resultado ----------
  const officialHosts = uniq([...scopeHosts, hint?.site && new URL(hint.site).hostname]);
  const contacts = mergeContacts(records, officialHosts);
  const relevantLeft = queue.filter(q => q.score >= 4).length;
  const complete = (!!site || saplOk) && !stopReason && relevantLeft === 0;
  const blocked = probed.filter(r => BLOCKED_STATUS.has(Number(r.status)) || ['robots', 'robots_indisponivel'].includes(r.status));
  let status;
  if (site || saplOk) status = complete ? 'concluido' : 'parcial';
  else if (blocked.length) status = 'bloqueado';
  else if (probed.some(r => r.status === 'tls' || r.status === 'timeout' || r.status === 'conexao')) status = contacts.length ? 'fonte_alternativa' : 'inacessivel';
  else status = contacts.length ? 'fonte_alternativa' : 'sem_site';

  if (stopReason) warnings.push(`Varredura interrompida por ${stopReason}${relevantLeft ? ` com ${relevantLeft} página(s) relevante(s) pendentes` : ''}.`);
  if (!site && saplOk) warnings.push('Portal principal não validado; dados obtidos do SAPL oficial.');
  else if (!site && blocked.length) warnings.push('O site existe, mas bloqueou a leitura automatizada (' + uniq(blocked.map(b => b.status)).join(', ') + '). Consulte manualmente.');
  else if (!site && !blocked.length) warnings.push('Nenhum portal da Câmara validado. Os contatos exibidos vêm de cadastros oficiais.');

  return {
    city, uf, status, complete,
    officialSite: site ? new URL(site.final).origin : '',
    saplUrl: saplResult?.origin || '',
    platform,
    registry: hint ? { cnpj: hint.cnpj, address: hint.address, email: hint.email, phone: hint.phone } : null,
    pagesVisited, contacts,
    attempts: attempts.slice(0, 60),
    warnings,
    elapsedMs: Date.now() - started,
  };
}
