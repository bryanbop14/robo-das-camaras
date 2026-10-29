import * as cheerio from 'cheerio';
import { BLOCKED_STATUS, fetchViaReader, fetchWithFallback, resolvePublic, robotsCheck, validPublicUrl } from './net.js';
import { detectPlatform, detectRole, extractContacts, mergeContacts, plausibleName, relevantLinks } from './extract.js';
import { collectSapl } from './sapl.js';
import { actLinks, actRecords, extractActs } from './acts.js';
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

const IPM_PATHS = [
  ['/cidadao/portal-do-vereador', 6],
  ['/cidadao/pagina/presidente-atual', 6],
  ['/cidadao/pagina/mesa-diretora', 5],
  ['/cidadao/pagina/estrutura-organizacional', 4],
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
  // Siglas parciais e combinações usadas por Câmaras: "cmbe" (Boa Esperança do Iguaçu), "camarawbraz" (Wenceslau Braz).
  const initFirstTwo = sig.length >= 3 ? sig[0][0] + sig[1][0] : '';
  const initPlusLast = sig.length >= 2 ? sig.slice(0, -1).map(w => w[0]).join('') + sig[sig.length - 1] : '';
  const lastWord = sig.length >= 2 && sig[sig.length - 1].length >= 5 && !['parana', 'oeste', 'norte', 'sul', 'leste'].includes(sig[sig.length - 1]) ? sig[sig.length - 1] : '';

  // Primeiro nome entra na onda 1: muitas Câmaras abreviam o município (ex.: camaraaltamira.pr.gov.br para "Altamira do Paraná").
  const primarySlugs = uniq([s, initSig, initAll, firstWord].filter(x => x && x.length >= 2));
  const secondarySlugs = uniq([s, initSig, initAll, firstTwo, firstWord, initFirstTwo, initPlusLast, lastWord].filter(x => x && x.length >= 2));
  const urls = [...(KNOWN[uf + ':' + city] || [])];

  // Onda 1: padrões mais frequentes (.leg.br, camara*.gov.br e cm*.gov.br) para nome completo e sigla.
  for (const k of primarySlugs) {
    urls.push(
      `https://www.${k}.${u}.leg.br`,
      `https://${k}.${u}.leg.br`,
      `https://www.camara${k}.${u}.gov.br`,
      `https://camara${k}.${u}.gov.br`,
      `https://www.cm${k}.${u}.gov.br`,
      `https://cm${k}.${u}.gov.br`
    );
  }
  // Onda 2: variações complementares (camarade*, cv*, .com.br, primeiro nome).
  for (const k of secondarySlugs) {
    urls.push(
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
  // Portais IPM Atende.Net hospedados no domínio do fornecedor (ex.: camarapinhais.atende.net).
  urls.push(`https://camara${s}.atende.net`, `https://cm${s}.atende.net`, `https://camaramunicipal${s}.atende.net`);
  return uniq(urls);
}

/**
 * Última pista antes dos buscadores: o site da Prefeitura costuma ter um link "Câmara Municipal" no menu ou rodapé.
 */
async function domainsFromPrefeitura(city, uf, deadline) {
  const s = cityKey(city), u = uf.toLowerCase();
  const homes = [`https://www.${s}.${u}.gov.br`, `https://${s}.${u}.gov.br`, `https://www.pm${s}.${u}.gov.br`, `https://www.prefeitura${s}.${u}.gov.br`];
  const out = [];
  await Promise.all(homes.map(async home => {
    const h = validPublicUrl(home);
    if (!h || !(await resolvePublic(h.hostname)).ok) return;
    const r = await fetchWithFallback(home, { timeout: 5000, deadline: Math.min(deadline, Date.now() + 6000), readerOnTimeout: false, bypassBlocks: false });
    if (r.status !== 200 || !r.html) return;
    const $ = cheerio.load(r.html);
    const prefHost = baseHost(new URL(r.url).hostname);
    $('a[href]').each((_, a) => {
      const label = ($(a).text() + ' ' + ($(a).attr('title') || '') + ' ' + $(a).find('img').attr('alt')).replace(/\s+/g, ' ');
      if (!/c[âa]mara|legislativo/i.test(label) || /comiss|t[ée]cnica|setorial|cultura|empres|dirigentes/i.test(label)) return;
      try {
        const t = new URL($(a).attr('href'), r.url);
        if (!/^https?:$/.test(t.protocol) || baseHost(t.hostname) === prefHost || EXCLUDED_SEARCH_HOSTS.test(t.hostname)) return;
        out.push(t.origin);
      } catch {}
    });
  }));
  return uniq(out).slice(0, 4);
}

const EXCLUDED_SEARCH_HOSTS = /facebook|instagram|youtube|wikipedia|google|bing\.com|microsoft|duckduckgo|jusbrasil|linkedin|twitter|x\.com|cidade-brasil|guiamais|apontador|cnpj|ibge\.gov\.br|senado\.leg\.br|camara\.leg\.br|tse\.jus\.br|tre-[a-z]{2}\.jus\.br|sitesmunicipais\.com\.br|globgov\.com|transparencia\.cc|todosnegocios|eguias|asp\.srv\.br|econodata|telelistas|solutudo|cybo\.com/i;

async function searchDomains(city, uf) {
  const testMode = process.env.ROBO_TEST_ALLOW_LOCAL === '1' && process.env.NODE_ENV !== 'production';
  if (testMode) return [];
  const key = process.env.SERPER_API_KEY;
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const keep = list => uniq(list).filter(o => o && !EXCLUDED_SEARCH_HOSTS.test(o)).slice(0, 4);
  const getHtml = async (url, ms = 4500) => {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9' } });
      return r.ok ? await r.text() : '';
    } catch { return ''; } finally { clearTimeout(timer); }
  };
  const originOf = href => { try { const u = new URL(href); return ['http:', 'https:'].includes(u.protocol) ? u.origin : null; } catch { return null; } };

  if (key) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `"Câmara Municipal de ${city}" ${uf} vereadores`, gl: 'br', hl: 'pt-br', num: 10 }),
      });
      if (response.ok) {
        const found = keep(((await response.json()).organic || []).map(r => originOf(r.link)));
        if (found.length) return found;
      }
    } catch {} finally { clearTimeout(timer); }
  }
  const q = encodeURIComponent(`"Câmara Municipal de ${city}" ${uf}`);
  // Buscadores gratuitos em paralelo (DuckDuckGo HTML e Bing): um deles costuma responder mesmo em IP de datacenter.
  const [ddg, bing] = await Promise.all([
    getHtml(`https://html.duckduckgo.com/html/?q=${q}`),
    getHtml(`https://www.bing.com/search?q=${q}&setlang=pt-BR&cc=BR`),
  ]);
  const origins = [];
  for (const m of ddg.matchAll(/uddg=([^&"'>]+)/g)) {
    try { origins.push(originOf(decodeURIComponent(m[1]))); } catch {}
  }
  for (const m of bing.matchAll(/<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"/g)) origins.push(originOf(m[1].replace(/&amp;/g, '&')));
  // Resultados com cara de Câmara primeiro.
  const ranked = keep(origins).sort((a, b) => Number(/c[aâ]mara|\bcm|leg\.br|cv/i.test(b)) - Number(/c[aâ]mara|\bcm|leg\.br|cv/i.test(a)));
  return ranked;
}

const FREE_MAIL = /@(?:gmail|hotmail|outlook|live|yahoo|bol|uol|terra|ig|globo|msn|icloud|zipmail|r7)\./i;

/** Deduz o site a partir dos e-mails institucionais conhecidos (cadastro Interlegis, cadastro estadual): camara@cmX.pr.gov.br → https://cmX.pr.gov.br. */
export function domainsFromEmails(emails) {
  const out = [];
  for (const raw of emails) {
    const email = cleanEmail(raw);
    if (!email || FREE_MAIL.test(email)) continue;
    const host = email.split('@')[1].toLowerCase();
    if (!/\.(?:leg|gov)\.br$|\.com\.br$/.test(host) || /^(?:mail|smtp|correio)\./.test(host)) continue;
    // Domínio de Prefeitura não é o site da Câmara.
    if (/^(?:www\.)?(?:pm|prefeitura)/.test(host)) continue;
    out.push(`https://www.${host.replace(/^www\./, '')}`, `https://${host.replace(/^www\./, '')}`);
  }
  return uniq(out);
}

/** E-mail gratuito com "cara" de domínio (camarawbraz@gmail.com) sugere o site: camarawbraz.pr.gov.br. Não é confiável sozinho. */
export function domainsFromFreeMail(emails, uf) {
  const out = [];
  const u = String(uf || '').toLowerCase();
  for (const raw of emails) {
    const email = cleanEmail(raw);
    if (!email || !FREE_MAIL.test(email)) continue;
    const local = email.split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
    if (!/^(?:camara|cm|cv|camaramunicipal|legislativo)[a-z]{3,20}$/.test(local)) continue;
    out.push(`https://www.${local}.${u}.gov.br`, `https://${local}.${u}.gov.br`, `https://www.${local}.${u}.leg.br`);
  }
  return uniq(out);
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
    ...$('img[alt]').map((_, el) => $(el).attr('alt')).get().slice(0, 15),
  ].filter(Boolean).join(' ');
  $('script,style,noscript').remove();
  const title = $('title').text() + ' ' + metaText + ' ' + $('h1,h2,.logo,header,[class*=brand]').text();
  const body = $('body').text().slice(0, 20000);
  const all = title + ' ' + body;
  if (!LEGISLATIVE.test(all) && !isPortalGov) return { ok: false, reason: 'HTTP 200, conteúdo não identificado como Câmara' };
  if (/prefeitura municipal/i.test(title) && !/c[aâ]mara/i.test(title) && !isPortalGov) return { ok: false, reason: 'HTTP 200, site da Prefeitura (não da Câmara)' };
  if (!trusted && !stripAccents(all).toLowerCase().replace(/[^a-z0-9]/g, '').includes(cityKey(city))) return { ok: false, reason: 'HTTP 200, Câmara de outro município' };
  if ($('body').text().trim().length < 120 && !isPortalGov && !/http-equiv=["']?refresh|location\.href/i.test(html)) return { ok: false, js: true, reason: 'HTTP 200, página vazia (provável aplicação JavaScript)' };
  return { ok: true };
}

/** Portais que montam o conteúdo no navegador (IPM Atende.Net, SPAs Vite/React/Angular). */
export function isJsPortal(html) {
  const h = String(html || '');
  return /static\/portal\/html\/elementos|__CONST\.PORTAL|atende\.net\/(?:cidadao|autoatendimento)/i.test(h)
    || /<div id=["'](?:root|app)["']>\s*<\/div>/i.test(h)
    || (/<script[^>]+type=["']module["'][^>]+src=["'][^"']*\/assets\//i.test(h) && h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length < 600);
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
  const prefPromise = testMode ? Promise.resolve([]) : domainsFromPrefeitura(city, uf, deadline).catch(() => []);
  let candidates = uniq([...fromHint, ...heuristicDomains(city, uf)]);
  const trusted = new Set(fromHint.map(u => new URL(u).origin).concat((KNOWN[uf + ':' + city] || [])));
  // Origens cujo conteúdo só aparece com JavaScript: as páginas internas também são lidas renderizadas.
  const renderOrigins = new Set();

  async function probe(url) {
    const u = validPublicUrl(url);
    if (!u) return { url, status: 'url_invalida' };
    const dns = await resolvePublic(u.hostname);
    if (!dns.ok) return { url, status: dns.status, quiet: !trusted.has(u.origin) };
    // Descoberta enxuta: robots.txt e home com tempo curto, sem Reader Proxy para servidor mudo.
    const probeDeadline = Math.min(deadline, Date.now() + (fast ? 6000 : 8000));
    const rob = await robotsCheck(u.origin + '/', probeDeadline, { bypassBlocks });
    if (!rob.allowed) return { url, status: rob.reason, reason: rob.detail, robotsText: rob.robotsText };
    let r = await fetchWithFallback(u.origin + '/', { timeout: fast ? 5000 : 7000, deadline, bypassBlocks, readerOnTimeout: false });
    if (r.status !== 200) return { url, status: r.status, reason: r.reason, robotsText: rob.robotsText };
    let isTrusted = trusted.has(u.origin) || trusted.has(new URL(r.url).origin);
    let id = identity(r.html, city, isTrusted);
    // Aplicação JavaScript (Vite/React, IPM Atende.Net...): renderiza pelo leitor e segue com o HTML resultante.
    if (!id.ok && (id.js || isJsPortal(r.html)) && bypassBlocks) {
      const rendered = await fetchViaReader(r.url, { timeout: fast ? 9000 : 12000, deadline });
      if (rendered.status === 200) {
        const rid = identity(rendered.html, city, isTrusted);
        if (rid.ok) { renderOrigins.add(new URL(r.url).origin); r = { ...rendered, url: r.url, reason: 'portal em JavaScript renderizado pelo leitor' }; id = rid; }
      }
    }
    const note = [rob.bypassed ? rob.detail : '', r.reason || ''].filter(Boolean).join(' · ');
    return id.ok
      ? { url, status: 200, final: r.url, html: r.html, reason: note, robotsText: rob.robotsText }
      : { url, status: 'nao_camara', reason: id.reason };
  }

  let site = null;
  const probed = [];
  const runProbes = async list => {
    for (let w = 0; w < list.length; w += 12) {
      const wave = list.slice(w, w + 12);
      const dnsChecked = await Promise.all(wave.map(async url => {
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
      if (!liveUrls.length) continue;
      // Não espera o candidato mais lento: assim que um responder como Câmara, aguarda só uma pequena janela
      // para preferir candidatos mais prioritários da mesma onda.
      const results = new Array(liveUrls.length);
      let firstOk = -1;
      const settled = liveUrls.map((url, i) => probe(url).then(r => { results[i] = r; if (r.status === 200 && (firstOk < 0 || i < firstOk)) firstOk = i; return r; }));
      await new Promise(resolve => {
        let pending = settled.length, graceTimer = null;
        settled.forEach(p => p.then(() => {
          pending--;
          if (!pending) { clearTimeout(graceTimer); resolve(); }
          else if (firstOk >= 0 && !graceTimer) graceTimer = setTimeout(resolve, 1200);
        }));
      });
      for (const r of results) {
        if (!r) continue;
        probed.push(r);
        if (!r.quiet) log(r.url, r.status, r.reason);
      }
      const found = results.find(r => r && r.status === 200);
      if (found) return found;
    }
    return null;
  };
  // Fontes confiáveis primeiro; os padrões heurísticos só são testados se elas falharem.
  // Inteligência de descoberta: o domínio do e-mail institucional (cadastro Interlegis / cadastro estadual) costuma ser o próprio site.
  // As duas frentes rodam em paralelo; o cadastro tem preferência quando ambas respondem.
  const firstWave = candidates.filter(u => trusted.has(new URL(u).origin));
  const emailProbe = (async () => {
    const state = await within(statePromise, Math.min(7000, deadline - Date.now() - 12000), null);
    const knownEmails = [hint?.email, ...(state?.contacts || []).map(c => c.email)];
    const fromEmails = domainsFromEmails(knownEmails).filter(u => !firstWave.includes(u));
    const fromFree = domainsFromFreeMail(knownEmails, uf).filter(u => !firstWave.includes(u) && !fromEmails.includes(u));
    if (!fromEmails.length && !fromFree.length) return null;
    fromEmails.forEach(u => trusted.add(new URL(u).origin));
    candidates = uniq([...fromEmails, ...fromFree, ...candidates]);
    const found = await runProbes([...fromEmails, ...fromFree]);
    if (found) found.discovery = fromEmails.includes(found.url) ? 'domínio do e-mail institucional oficial' : 'e-mail da Câmara (padrão do endereço)';
    return found;
  })();
  if (firstWave.length) site = await runProbes(firstWave);
  if (!site) site = await emailProbe;
  const tried = new Set(probed.map(p => p.url));
  if (!site) site = await runProbes(candidates.filter(u => !firstWave.includes(u) && !tried.has(u)));
  // Domínio existe (DNS ok) mas o servidor demorou: provedores compartilhados respondem devagar sob carga.
  // Uma segunda tentativa, sozinha e com mais tempo, costuma passar.
  if (!site) {
    const slow = uniq(probed.filter(r => ['timeout', 'conexao'].includes(String(r.status)) && !r.quiet).map(r => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean)).slice(0, 2);
    for (const host of slow) {
      if (site || Date.now() > deadline - 12000) break;
      const url = 'https://www.' + host;
      const r = await fetchWithFallback(url + '/', { timeout: fast ? 9000 : 12000, deadline, bypassBlocks, readerOnTimeout: false });
      const alt = r.status === 200 ? r : await fetchWithFallback('https://' + host + '/', { timeout: fast ? 7000 : 10000, deadline, bypassBlocks, readerOnTimeout: false });
      if (alt.status !== 200) continue;
      const id = identity(alt.html, city, trusted.has(new URL(alt.url).origin));
      log(url, id.ok ? 200 : 'nao_camara', id.ok ? 'respondeu na segunda tentativa (servidor lento)' : id.reason);
      if (id.ok) site = { url, status: 200, final: alt.url, html: alt.html, reason: 'segunda tentativa' };
    }
  }
  if (!site) {
    // Links "Câmara Municipal" no site da Prefeitura e resultados de buscadores.
    const [fromPref, fromSearch] = await Promise.all([
      within(prefPromise, Math.max(0, deadline - Date.now() - 9000), []),
      within(searchPromise, Math.max(0, deadline - Date.now() - 9000), []),
    ]);
    const extra = uniq([...fromPref, ...fromSearch]).filter(o => !candidates.includes(o) && !candidates.includes(o.replace(/\/$/, '')));
    if (extra.length && Date.now() < deadline - 8000) {
      candidates = candidates.concat(extra);
      site = await runProbes(extra);
      if (site) site.discovery = fromPref.includes(new URL(site.url).origin) ? 'link no site da Prefeitura' : 'buscador';
    }
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
  // Páginas lidas pelo leitor (portais JavaScript) são mais lentas: orçamento próprio.
  const renderLimit = fast ? 6 : 16;
  let renderedPages = 0;
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
  // Atos oficiais (portarias, atos da Mesa, diário oficial) descobertos durante a navegação.
  const actListings = new Map(), actDocs = new Map();
  const collectActLinks = (html, url) => {
    try {
      const { listings, docs } = actLinks(html, url, inScope);
      for (const l of listings) if ((actListings.get(l.url) || 0) < l.score) actListings.set(l.url, l.score);
      for (const d of docs) if ((actDocs.get(d.url) || 0) < d.score) actDocs.set(d.url, d.score);
    } catch {}
  };

  if (site) {
    // Home com menu montado em JavaScript (quase nenhum link interno): passa a ler o portal renderizado.
    try {
      const o = new URL(site.final).origin;
      if (!renderOrigins.has(o) && bypassBlocks) {
        const internal = cheerio.load(site.html)('a[href]').toArray().filter(a => { try { return new URL(a.attribs.href, site.final).origin === o; } catch { return false; } }).length;
        if (internal < 5) {
          const rendered = await fetchViaReader(site.final, { timeout: fast ? 9000 : 12000, deadline });
          if (rendered.status === 200 && (rendered.html.match(/<a /g) || []).length > internal + 5) {
            renderOrigins.add(o);
            site.html = rendered.html;
            log(o, 200, 'menu em JavaScript: portal lido renderizado');
          }
        }
      }
    } catch {}
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
    collectActLinks(site.html, home);
    if (/Softcam/i.test(platform)) {
      for (const [p, s] of SOFTCAM_PATHS) push(origin + p, s, 1, true);
    }
    // IPM Atende.Net (portal montado em JavaScript): rotas padrão de vereadores, presidência e estrutura.
    if (renderOrigins.has(origin) && /IPM|atende/i.test(platform + ' ' + site.html.slice(0, 200000) + ' ' + home)) {
      platform = platform && !/IPM/.test(platform) ? platform + ', IPM Atende.Net' : (platform || 'IPM Atende.Net');
      for (const [p, s] of IPM_PATHS) push(origin + p, s, 1, true);
    }
    if (renderOrigins.has(origin) && !platform) platform = 'Aplicação JavaScript (renderizada)';
    if (!/PortalGov/i.test(platform) && !renderOrigins.has(origin)) {
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
    if (Date.now() > deadline - ((actListings.size || actDocs.size) ? 9000 : 2500)) { stopReason = 'limite de tempo'; break; }
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
      let origin = ''; try { origin = new URL(e.url).origin; } catch {}
      if (renderOrigins.has(origin) && !/\.pdf(\?|$)/i.test(e.url)) {
        if (renderedPages >= renderLimit) return { ...e, status: 'limite_render', reason: 'limite de páginas renderizadas' };
        renderedPages++;
        return { ...e, ...(await fetchViaReader(e.url, { timeout: fast ? 9000 : 12000, deadline })) };
      }
      return { ...e, ...(await fetchWithFallback(e.url, { timeout: fast ? 6000 : 8000, deadline, bypassBlocks })) };
    }));
    for (const page of pages.filter(Boolean)) {
      if (page.status !== 200 || !page.html) {
        if (!(page.guess && [404, 410].includes(page.status)) && page.status !== 'limite_render') log(page.url, page.status, page.reason);
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
      collectActLinks(page.html, page.url);
      if (page.depth < 3) for (const l of relevantLinks(page.html, page.url, inScope)) push(l.url, Math.max(1, l.score - (page.depth >= 2 ? 1 : 0)), page.depth + 1);
    }
  }

  // ---------- 3b. Robô de atos oficiais (portarias / atos da Mesa / diário oficial) ----------
  let actsInfo = null;
  if (site && Date.now() < deadline - 5000 && (actListings.size || actDocs.size)) {
    const budget = fast ? { listings: 2, docs: 5 } : { listings: 5, docs: 14 };
    const collected = { appointments: [], dismissals: [] };
    const seenDocs = new Set();
    let listingsRead = 0, docsRead = 0;
    const readAct = async (url, isListing) => {
      const key = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (seenDocs.has(key) || Date.now() > deadline - 3000) return;
      seenDocs.add(key);
      const r = await fetchWithFallback(url, { timeout: fast ? 6000 : 8000, deadline, bypassBlocks });
      if (r.status !== 200 || !r.html) return;
      isListing ? listingsRead++ : docsRead++;
      const text = r.pdfText || cheerio.load(r.html)('body').text();
      const acts = extractActs(text);
      acts.appointments.forEach(a => { a.source = r.url; });
      collected.appointments.push(...acts.appointments);
      collected.dismissals.push(...acts.dismissals);
      if (isListing || !r.pdfText) collectActLinks(r.html, r.url);
    };
    // Listagens (inclui o filtro do ano corrente), depois os documentos mais promissores.
    for (let round = 0; round < 2 && listingsRead < budget.listings; round++) {
      const next = [...actListings.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u)
        .filter(u => !seenDocs.has(u.replace(/^https?:\/\//, '').replace(/\/$/, ''))).slice(0, budget.listings - listingsRead);
      if (!next.length) break;
      await Promise.all(next.map(u => readAct(u, true)));
    }
    const docs = [...actDocs.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, budget.docs);
    for (let i = 0; i < docs.length && Date.now() < deadline - 3000; i += 4) {
      await Promise.all(docs.slice(i, i + 4).map(u => readAct(u, false)));
    }
    const actContacts = actRecords(collected, site.final, extractCtx);
    records.push(...actContacts);
    actsInfo = { listings: listingsRead, documents: docsRead, appointments: actContacts.length };
    log(new URL(site.final).origin + ' (atos oficiais)', 200, `${listingsRead} listagem(ns) e ${docsRead} documento(s) de portarias/atos lidos; ${actContacts.length} nomeação(ões) vigente(s)`);
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
    discovery: site?.discovery || (site ? (trusted.has(new URL(site.url).origin) ? 'cadastro oficial' : 'padrão de domínio / busca') : ''),
    acts: actsInfo,
    attempts: attempts.slice(0, 60),
    warnings,
    elapsedMs: Date.now() - started,
  };
}
