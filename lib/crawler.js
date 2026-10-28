import * as cheerio from 'cheerio';
import { BLOCKED_STATUS, fetchWithFallback, resolvePublic, robotsCheck, validPublicUrl } from './net.js';
import { detectPlatform, detectRole, extractContacts, mergeContacts, plausibleName, relevantLinks } from './extract.js';
import { collectSapl } from './sapl.js';
import { stateSources } from './official-sources.js';
import { searchSnippets } from './search.js';
import { cityKey, cleanEmail, normalizePhone, stripAccents, uniq } from './text.js';

// Domínios que não seguem o padrão do nome e não estão no cadastro Interlegis.
const KNOWN = {
  'AM:Manaus': ['https://www.cmm.am.gov.br'],
  'PA:Belém': ['https://cmb.pa.gov.br'],
  'RJ:Rio de Janeiro': ['https://www.camara.rj.gov.br'],
  'RJ:Três Rios': ['https://www.cvtr.rj.gov.br'],
  'SP:São Paulo': ['https://www.saopaulo.sp.leg.br'],
  'PE:Recife': ['https://www.recife.pe.leg.br'],
  'CE:Quixadá': ['https://camaraquixada.ce.gov.br'],
  'PR:Coronel Vivida': ['https://www.camaracoronelvivida.pr.gov.br'],
  'PR:Cruzeiro do Oeste': ['https://www.cmcruzeirodooeste.pr.gov.br'],
  'PR:Douradina': ['https://www.douradina.pr.leg.br'],
  'DF:Brasília': ['https://www.cl.df.gov.br'],
};

const GUESS_PATHS = {
  fast: ['/vereadores', '/contato', '/mesa-diretora', '/telefones-uteis', '/servidores', '/quadro-funcional'],
  full: ['/vereadores', '/parlamentares', '/processo-legislativo/vereadores', '/mesa-diretora',
    '/camara/membros/exercicio/0', '/contato', '/contatos', '/fale-conosco', '/atendimento', '/ouvidoria', '/sic',
    '/telefones-uteis', '/servidores', '/quadro-funcional', '/quem-e-quem', '/estrutura-organizacional', '/organograma',
    '/institucional', '/a-camara', '/sitemap', '/mapa-do-site'],
};

const SOFTCAM_PATHS = [
  ['/ajax/header_menu/Vereadores', 6],
  ['/ajax/header_menu/A-Camara', 6],
  ['/ajax/header_menu/Atendimento', 5],
  ['/camara/membros/exercicio/0', 5],
  ['/sitemap', 5],
];

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
  const words = stripAccents(city).toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const sig = words.filter(w => !['de', 'da', 'do', 'das', 'dos', 'e'].includes(w));
  const initSig = sig.length >= 2 ? sig.map(w => w[0]).join('') : '';
  const initAll = words.length >= 2 ? words.map(w => w[0]).join('') : '';
  const firstWord = sig.length >= 2 && sig[0].length >= 4 ? sig[0] : '';
  const firstTwo = sig.length >= 3 ? sig[0] + sig[1] : '';
  const singleInit = words.length === 1 && words[0].length >= 4 ? words[0][0] : '';

  const mainSlugs = uniq([s, initSig, initAll, firstTwo, firstWord].filter(x => x && x.length >= 2));
  const urls = [...(KNOWN[uf + ':' + city] || [])];

  for (const k of mainSlugs) {
    urls.push(
      `https://www.${k}.${u}.leg.br`,
      `https://${k}.${u}.leg.br`,
      `https://www.camara${k}.${u}.gov.br`,
      `https://camara${k}.${u}.gov.br`,
      `https://www.cm${k}.${u}.gov.br`,
      `https://cm${k}.${u}.gov.br`,
      `https://www.camarade${k}.${u}.gov.br`,
      `https://camarade${k}.${u}.gov.br`,
      `https://www.camaramunicipalde${k}.${u}.gov.br`,
      `https://www.cm${k}.${u}.leg.br`,
      `https://cm${k}.${u}.leg.br`,
      `https://www.camara${k}.${u}.leg.br`,
      `https://camara${k}.${u}.leg.br`,
      `https://www.cv${k}.${u}.gov.br`,
      `https://cv${k}.${u}.gov.br`,
      `https://www.camara${k}.com.br`,
      `https://camara${k}.com.br`
    );
  }
  if (singleInit) {
    urls.push(`https://cm${singleInit}.${u}.gov.br`, `https://www.cm${singleInit}.${u}.gov.br`);
  }
  return uniq(urls);
}

const EXCLUDED_SEARCH_HOSTS = /facebook|instagram|youtube|wikipedia|google|jusbrasil|linkedin|twitter|x\.com|cidade-brasil|guiamais|apontador|cnpj|ibge\.gov\.br|senado\.leg\.br|camara\.leg\.br|tse\.jus\.br|tre-[a-z]{2}\.jus\.br|sitesmunicipais\.com\.br|globgov\.com|transparencia\.cc/i;

async function searchDomains(city, uf) {
  const testMode = process.env.ROBO_TEST_ALLOW_LOCAL === '1' && process.env.NODE_ENV !== 'production';
  if (testMode) return [];
  const key = process.env.SERPER_API_KEY;
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    if (key) {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `"Câmara Municipal de ${city}" ${uf} vereadores`, gl: 'br', hl: 'pt-br', num: 10 }),
      });
      if (!response.ok) return [];
      const data = await response.json();
      return uniq((data.organic || []).map(r => { try { return new URL(r.link).origin; } catch { return null; } }))
        .filter(o => o && !EXCLUDED_SEARCH_HOSTS.test(o))
        .slice(0, 4);
    }
    // Fallback gratuito via DuckDuckGo HTML quando SERPER_API_KEY não está configurada.
    const q = encodeURIComponent(`"Câmara Municipal de ${city}" ${uf}`);
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
    });
    if (!response.ok) return [];
    const html = await response.text();
    const origins = [];
    for (const m of html.matchAll(/uddg=([^&"'>]+)/g)) {
      try {
        const u = new URL(decodeURIComponent(m[1]));
        if (['http:', 'https:'].includes(u.protocol) && !EXCLUDED_SEARCH_HOSTS.test(u.hostname)) {
          origins.push(u.origin);
        }
      } catch {}
    }
    return uniq(origins).slice(0, 4);
  } catch { return []; } finally { clearTimeout(timer); }
}

/** Espera `promise` por até `ms`; devolve `fallback` se o tempo acabar, sem deixar timer pendurado. */
function within(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise(r => { timer = setTimeout(() => r(fallback), Math.max(0, ms)); })]).finally(() => clearTimeout(timer));
}

const baseHost = host => host.toLowerCase().replace(/^www\d?\./, '');

/** Coleta vereadores, Mesa Diretora, servidores e contato institucional via API JSON de portais PortalGov (MTW / AngularJS). */
async function collectPortalGov(origin, deadline) {
  const records = [];
  const attempts = [];
  const postJson = async (path, body) => {
    const remaining = Math.min(6000, deadline - Date.now());
    if (remaining < 600) return null;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), remaining);
    try {
      const r = await fetch(origin + path, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
          referer: origin + '/home',
          'x-requested-with': 'XMLHttpRequest',
        },
        body,
      });
      if (!r.ok) return null;
      const data = await r.json();
      return Array.isArray(data) ? data : null;
    } catch { return null; } finally { clearTimeout(timer); }
  };

  const [cfg, mesa, vereadores, funcionarios, secretarias] = await Promise.all([
    postJson('/controllers/config/class_config.php', 'func=8'),
    postJson('/controllers/vereador/class_vereador.php', 'func=9'),
    postJson('/controllers/vereador/class_vereador.php', 'func=7'),
    postJson('/controllers/funcionario/class_funcionario.php', 'func=7'),
    postJson('/controllers/secretaria/class_secretaria.php', 'func=8'),
  ]);

  let defaultEmail = '', defaultPhone = '';
  if (cfg && cfg[0]) {
    defaultEmail = cleanEmail(cfg[0].email || '');
    defaultPhone = normalizePhone(cfg[0].telefone || '');
    if (defaultEmail || defaultPhone) {
      records.push({
        name: '',
        role: 'Contato institucional',
        sector: 'institucional',
        email: defaultEmail,
        phone: defaultPhone,
        source: origin + '/home',
        type: 'geral',
      });
    }
  }

  const mesaById = new Map();
  if (mesa && mesa.length) {
    for (const m of mesa) {
      const rawCargo = String(m.cargo || '').replace(/^\*+/, '').trim();
      const { role, sector } = detectRole(rawCargo);
      const roleLabel = (role || rawCargo || 'Membro') + ' (Mesa Diretora)';
      const secLabel = /^presidente$/i.test(role || rawCargo) ? 'decisor' : (sector || 'mesa');
      if (m.cod_) mesaById.set(String(m.cod_), { role: roleLabel, sector: secLabel });
      const name = plausibleName(m.nome || '');
      if (name) {
        mesaById.set('n:' + cityKey(name), { role: roleLabel, sector: secLabel, name, cod: m.cod_, slug: m.titulo_sem_acento });
      }
    }
  }

  if (vereadores && vereadores.length) {
    attempts.push({ url: origin + '/vereadores', status: 200, reason: `${vereadores.length} vereadores via API PortalGov` });
    for (const v of vereadores) {
      const name = plausibleName(v.nome || '');
      if (!name) continue;
      const mInfo = (v.cod_ && mesaById.get(String(v.cod_))) || mesaById.get('n:' + cityKey(name));
      const email = cleanEmail(v.email || '') || defaultEmail;
      const src = v.cod_ ? `${origin}/vereadores/${v.titulo_sem_acento || 'parlamentar'}/${v.cod_}` : `${origin}/vereadores`;
      records.push({
        name,
        role: mInfo ? mInfo.role : 'Vereador(a)',
        sector: mInfo ? mInfo.sector : 'parlamentar',
        email,
        phone: defaultPhone,
        source: src,
        type: 'perfil',
      });
    }
  }

  // Caso algum membro da Mesa Diretora não tenha vindo na lista geral de vereadores:
  for (const [k, m] of mesaById.entries()) {
    if (!k.startsWith('n:') || !m.name) continue;
    if (!records.some(r => r.name && cityKey(r.name) === cityKey(m.name))) {
      records.push({
        name: m.name,
        role: m.role,
        sector: m.sector,
        email: defaultEmail,
        phone: defaultPhone,
        source: `${origin}/mesa_diretora`,
        type: 'diretório',
      });
    }
  }

  if (funcionarios && funcionarios.length) {
    attempts.push({ url: origin + '/assessoria_de_imprensa', status: 200, reason: `${funcionarios.length} servidor(es) via API PortalGov` });
    for (const f of funcionarios) {
      const name = plausibleName(f.nome || '');
      if (!name) continue;
      const rawCargo = String(f.cargo || '').trim();
      const { role, sector } = detectRole(rawCargo);
      const email = cleanEmail(f.email || '') || defaultEmail;
      records.push({
        name,
        role: rawCargo || role || 'Servidor(a)',
        sector: sector || 'administrativo',
        email,
        phone: defaultPhone,
        source: origin + '/home',
        type: 'diretório',
      });
    }
  }

  if (secretarias && secretarias.length) {
    for (const s of secretarias) {
      if (/^prefeit/i.test(String(s.tipo || '') + ' ' + String(s.nome || ''))) continue;
      const name = plausibleName(s.nome_sec || '');
      const unitName = String(s.nome || '').trim();
      const { role, sector } = detectRole(unitName);
      const email = cleanEmail(s.email || '') || defaultEmail;
      const phone = [s.telefone_1, s.telefone_2].map(normalizePhone).filter(Boolean).join(' / ') || defaultPhone;
      if (name || email || phone) {
        records.push({
          name,
          role: unitName || role || 'Setor',
          sector: sector || 'gestao',
          email,
          phone,
          source: origin + '/secretarias',
          type: name ? 'diretório' : 'setor',
        });
      }
    }
  }

  return { records, attempts, defaultEmail, defaultPhone };
}

/** Página pertence a uma Câmara (e, se não veio do cadastro oficial, à Câmara DESTE município). */
function identity(html, city, trusted) {
  const $ = cheerio.load(html);
  const isPortalGov = /portalgovApp/i.test(html) && /control_rota_vereador/i.test(html);
  const metaText = [
    $('meta[name="description"]').attr('content'),
    $('meta[name="keywords"]').attr('content'),
    $('meta[property="og:title"]').attr('content'),
    $('meta[property="og:site_name"]').attr('content'),
    $('meta[property="og:description"]').attr('content'),
  ].filter(Boolean).join(' ');
  $('script,style,noscript').remove();
  const title = $('title').text() + ' ' + metaText + ' ' + $('h1,h2,.logo,header,[class*=brand]').text();
  const body = $('body').text().slice(0, 20000);
  const all = title + ' ' + body;
  if (!LEGISLATIVE.test(all) && !isPortalGov) return { ok: false, reason: 'HTTP 200, conteúdo não identificado como Câmara' };
  if (/prefeitura municipal/i.test(title) && !/c[aâ]mara/i.test(title) && !isPortalGov) return { ok: false, reason: 'HTTP 200, site da Prefeitura (não da Câmara)' };
  if (!trusted && !stripAccents(all).toLowerCase().replace(/[^a-z0-9]/g, '').includes(cityKey(city))) return { ok: false, reason: 'HTTP 200, Câmara de outro município' };
  if ($('body').text().trim().length < 120 && !isPortalGov && !/http-equiv=["']?refresh|location\.href/i.test(html)) return { ok: false, reason: 'HTTP 200, página vazia (provável aplicação JavaScript)' };
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
 * opts: { fast, hint, bypassBlocks } — hint é o registro do cadastro Interlegis vindo do painel.
 */
export async function scanCamara(city, uf, opts = {}) {
  const fast = !!opts.fast;
  const testMode = process.env.ROBO_TEST_ALLOW_LOCAL === '1' && process.env.NODE_ENV !== 'production';
  const bypassBlocks = opts.bypassBlocks ?? !testMode;
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
    const rob = await robotsCheck(u.origin + '/', deadline, { bypassBlocks });
    if (!rob.allowed) return { url, status: rob.reason, reason: rob.detail, robotsText: rob.robotsText };
    const r = await fetchWithFallback(u.origin + '/', { timeout: fast ? 7000 : 9000, deadline, bypassBlocks });
    if (r.status !== 200) return { url, status: r.status, reason: r.reason, robotsText: rob.robotsText };
    const id = identity(r.html, city, trusted.has(u.origin) || trusted.has(new URL(r.url).origin));
    const note = [rob.bypassed ? rob.detail : '', r.reason || ''].filter(Boolean).join(' · ');
    return id.ok
      ? { url, status: 200, final: r.url, html: r.html, reason: note, robotsText: rob.robotsText }
      : { url, status: 'nao_camara', reason: id.reason };
  }

  let site = null;
  const probed = [];
  const runProbes = async list => {
    const dnsChecked = await Promise.all(list.map(async url => {
      const u = validPublicUrl(url);
      if (!u) return { url, status: 'url_invalida' };
      const dns = await resolvePublic(u.hostname);
      return dns.ok ? { url, u, live: true } : { url, status: dns.status, quiet: !trusted.has(u.origin) };
    }));
    const liveUrls = [];
    for (const d of dnsChecked) {
      if (d.live) liveUrls.push(d.url);
      else {
        probed.push(d);
        if (!d.quiet) log(d.url, d.status, d.reason);
      }
    }
    for (let i = 0; i < liveUrls.length; i += 6) {
      const batch = liveUrls.slice(i, i + 6);
      const results = await Promise.all(batch.map(probe));
      for (const r of results) {
        probed.push(r);
        if (!r.quiet) log(r.url, r.status, r.reason);
      }
      const found = results.find(r => r.status === 200);
      if (found) return found;
    }
    return null;
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
  const inScope = u => {
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if ([...scopeHosts].some(h => { const b = baseHost(u.hostname); return b === h || b.endsWith('.' + h); })) return true;
    if (/\.pdf(\?|$)/i.test(u.pathname) && /cloudsoftcam\.com\.br$/i.test(u.hostname)) return true;
    return false;
  };
  const pageLimit = fast ? 16 : 60;
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

  const extractCtx = {
    fallbackEmail: hint?.email || '',
    fallbackPhone: hint?.phone || '',
  };

  if (site) {
    const home = site.final;
    platform = detectPlatform(site.html, home);
    visited.add(home.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    queued.add(home.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    pagesVisited++;
    const origin = new URL(home).origin;
    if (/PortalGov/i.test(platform)) {
      const pg = await collectPortalGov(origin, deadline);
      records.push(...pg.records);
      pg.attempts.forEach(a => attempts.push(a));
      if (pg.defaultEmail && !extractCtx.fallbackEmail) extractCtx.fallbackEmail = pg.defaultEmail;
      if (pg.defaultPhone && !extractCtx.fallbackPhone) extractCtx.fallbackPhone = pg.defaultPhone;
    }
    const homeContacts = extractContacts(site.html, home, extractCtx);
    records.push(...homeContacts);
    for (const c of homeContacts) {
      if (c.email && !extractCtx.fallbackEmail) extractCtx.fallbackEmail = c.email;
      if (c.phone && !extractCtx.fallbackPhone) extractCtx.fallbackPhone = c.phone;
    }
    for (const l of relevantLinks(site.html, home, inScope)) push(l.url, l.score, 1);
    if (/Softcam/i.test(platform)) {
      for (const [p, s] of SOFTCAM_PATHS) push(origin + p, s, 1, true);
    }
    if (!/PortalGov/i.test(platform)) {
      for (const p of GUESS_PATHS[fast ? 'fast' : 'full']) push(origin + p, 3, 1, true);
    }
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

  const CONCURRENCY = /Softcam/i.test(platform) ? 4 : 6;
  while (true) {
    if (!saplResult) {
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
    // No modo rápido, para quando só restarem páginas de baixa relevância e já houver contatos nomeados.
    if (fast && queue[0].score < 4 && records.some(r => r.name)) break;
    const batch = queue.splice(0, Math.min(CONCURRENCY, pageLimit - pagesVisited));
    const pages = await Promise.all(batch.map(async e => {
      const key = e.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (visited.has(key)) return null;
      visited.add(key);
      const rob = await robotsCheck(e.url, deadline, { bypassBlocks });
      if (!rob.allowed) return { ...e, status: rob.reason, reason: rob.detail };
      return { ...e, ...(await fetchWithFallback(e.url, { timeout: fast ? 6000 : 8000, deadline, bypassBlocks })) };
    }));
    for (const page of pages.filter(Boolean)) {
      if (page.status !== 200 || !page.html) {
        if (!(page.guess && [404, 410].includes(page.status))) log(page.url, page.status, page.reason);
        continue;
      }
      pagesVisited++;
      const known = profileRoles.get(page.url.replace(/\/$/, ''));
      const found = extractContacts(page.html, page.url, extractCtx);
      for (const c of found) {
        if (c.email && !extractCtx.fallbackEmail) extractCtx.fallbackEmail = c.email;
        if (c.phone && c.phone.length > (extractCtx.fallbackPhone || '').length) extractCtx.fallbackPhone = c.phone;
      }
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

  // Site bloqueado/ausente ou com pouco resultado: trechos já indexados por buscador (sem tocar no site).
  const blockedEarly = probed.some(r => BLOCKED_STATUS.has(Number(r.status)) || ['robots', 'robots_indisponivel'].includes(r.status));
  if ((!site || blockedEarly || !records.some(r => r.name)) && Date.now() < deadline - 2000) {
    const hosts = uniq([siteHost, ...probed.filter(r => r.status !== 'dns_inexistente').map(r => { try { return baseHost(new URL(r.url).hostname); } catch { return ''; } }), hint?.site && baseHost(new URL(hint.site).hostname)]);
    const found = await within(searchSnippets(city, uf, hosts), Math.min(6000, deadline - Date.now() - 1500), null);
    if (found) { records.push(...found.records); found.attempts.forEach(a => attempts.push(a)); }
  }

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
    robotsText: probed.find(r => r.robotsText)?.robotsText || '',
    blockedUrls: probed.filter(r => BLOCKED_STATUS.has(Number(r.status)) || ['robots', 'robots_indisponivel'].includes(r.status)).map(r => r.url),
    registry: hint ? { cnpj: hint.cnpj, address: hint.address, email: hint.email, phone: hint.phone } : null,
    pagesVisited, contacts,
    attempts: attempts.slice(0, 60),
    warnings,
    elapsedMs: Date.now() - started,
  };
}
