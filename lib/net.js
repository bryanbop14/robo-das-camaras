import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const AGENT = 'RiolePublicContactResearch/0.5 (+consulta a contatos institucionais publicos)';
const MAX_BYTES = 1_500_000;
const DNS_TTL = 10 * 60 * 1000;
const dnsCache = new Map();

function privateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function privateIP(ip) {
  if (net.isIPv4(ip)) return privateIPv4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIPv4(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

/** Resolve o host e recusa destinos internos. Resultado em cache para acelerar candidatos repetidos. */
export async function resolvePublic(host, timeout = 2500) {
  if (TEST_MODE) return ['127.0.0.1', 'localhost'].includes(host) ? { ok: true } : { ok: false, status: 'dns_inexistente' };
  const hit = dnsCache.get(host);
  if (hit && Date.now() - hit.time < DNS_TTL) return hit.result;
  let result;
  try {
    let timer;
    const addrs = await Promise.race([
      lookup(host, { all: true }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('dns timeout'), { code: 'ETIMEOUT' })), timeout); }),
    ]).finally(() => clearTimeout(timer));
    result = addrs.length && addrs.every(a => !privateIP(a.address)) ? { ok: true } : { ok: false, status: 'ip_privado' };
  } catch (e) {
    result = { ok: false, status: e.code === 'ETIMEOUT' ? 'dns_timeout' : 'dns_inexistente' };
  }
  dnsCache.set(host, { time: Date.now(), result });
  if (dnsCache.size > 3000) dnsCache.delete(dnsCache.keys().next().value);
  return result;
}

// Somente para a suíte de testes local (servidor em 127.0.0.1). Nunca habilitar em produção.
const TEST_MODE = process.env.ROBO_TEST_ALLOW_LOCAL === '1' && process.env.NODE_ENV !== 'production';

export function validPublicUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (TEST_MODE) { u.hash = ''; return u; }
    if (u.port && !['80', '443'].includes(u.port)) return null;
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) || !u.hostname.includes('.')) return null;
    u.hash = '';
    return u;
  } catch { return null; }
}

function classifyError(e) {
  const code = e?.cause?.code || e?.code || '';
  if (e?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return 'timeout';
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO|ALTNAME|EPROTO/i.test(code + ' ' + (e?.cause?.message || ''))) return 'tls';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'dns_inexistente';
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET/.test(code)) return 'conexao';
  return 'erro';
}

async function readCapped(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= maxBytes) { try { await reader.cancel(); } catch {} break; }
  }
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
  const type = response.headers.get('content-type') || '';
  const charset = /charset=([\w-]+)/i.exec(type)?.[1]?.toLowerCase();
  let text = buf.toString(charset && /8859|1252|latin/.test(charset) ? 'latin1' : 'utf8');
  if (!charset && text.includes('�')) {
    const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(text)?.[1]?.toLowerCase();
    if (meta && /8859|1252|latin/.test(meta)) text = buf.toString('latin1');
  }
  return text;
}

/**
 * GET seguro: só hosts públicos, até 4 redirecionamentos (cada um revalidado), corpo limitado.
 * Retorna { status, url (final), html|json|text, contentType, reason }.
 */
export async function safeFetch(rawUrl, { accept = 'text/html,application/xhtml+xml', timeout = 6000, maxBytes = MAX_BYTES, deadline } = {}) {
  let current = validPublicUrl(rawUrl);
  if (!current) return { status: 'url_invalida', url: String(rawUrl) };
  const started = Date.now();
  for (let hop = 0; hop < 5; hop++) {
    const dns = await resolvePublic(current.hostname);
    if (!dns.ok) return { status: dns.status, url: current.href };
    const remaining = deadline ? Math.min(timeout - (Date.now() - started), deadline - Date.now()) : timeout - (Date.now() - started);
    if (remaining < 400) return { status: 'timeout', url: current.href };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetch(current.href, {
        headers: { 'user-agent': AGENT, accept, 'accept-language': 'pt-BR,pt;q=0.9' },
        redirect: 'manual', cache: 'no-store', signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const next = validPublicUrl(new URL(response.headers.get('location') || '', current).href);
        try { await response.body?.cancel(); } catch {}
        if (!next) return { status: 'redirect_invalido', url: current.href };
        current = next;
        continue;
      }
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok) {
        try { await response.body?.cancel(); } catch {}
        return { status: response.status, url: current.href };
      }
      if (contentType.includes('json')) {
        const text = await readCapped(response, maxBytes);
        try { return { status: 200, url: current.href, json: JSON.parse(text), contentType }; }
        catch { return { status: 'json_invalido', url: current.href }; }
      }
      if (!contentType || /text\/|html|xml/.test(contentType)) {
        const text = await readCapped(response, maxBytes);
        return { status: 200, url: current.href, html: text, contentType };
      }
      try { await response.body?.cancel(); } catch {}
      return { status: 'tipo_nao_suportado', url: current.href, contentType };
    } catch (e) {
      return { status: classifyError(e), url: current.href, reason: e?.cause?.code || e.message };
    } finally { clearTimeout(timer); }
  }
  return { status: 'redirects_demais', url: current.href };
}

/** Tenta https e, se falhar por TLS/conexão, a versão http do mesmo endereço (muitos .leg.br só respondem em http). */
export async function fetchWithFallback(url, options) {
  const first = await safeFetch(url, options);
  if (first.status === 200 || !/^https:/i.test(url) || !['tls', 'conexao', 'erro'].includes(String(first.status))) return first;
  const second = await safeFetch(url.replace(/^https:/i, 'http:'), options);
  return second.status === 200 ? { ...second, reason: 'https falhou (' + first.status + '); lido via http' } : first;
}

export const BLOCKED_STATUS = new Set([401, 403, 406, 429, 451, 503]);

// ---------- robots.txt (RFC 9309) ----------
const robotsCache = new Map();

function parseRobots(text) {
  const groups = [];
  let agents = [], rules = [];
  const flush = () => { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; };
  // BOM no início (comum em IIS) faria a primeira linha "User-agent" ser ignorada.
  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'user-agent') { if (rules.length) flush(); agents.push(value.toLowerCase()); }
    else if (key === 'allow' || key === 'disallow') { if (agents.length) rules.push({ allow: key === 'allow', path: value }); }
  }
  flush();
  return groups;
}

function ruleMatches(path, rule) {
  if (!rule.path) return false;
  const pattern = '^' + rule.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
  try { return new RegExp(pattern).test(path); } catch { return path.startsWith(rule.path); }
}

export async function robotsAllowed(url, deadline) {
  return (await robotsCheck(url, deadline)).allowed;
}

/** { allowed, reason }: reason = 'robots' (regra Disallow) ou 'robots_indisponivel' (servidor não respondeu o robots.txt). */
export async function robotsCheck(url, deadline) {
  const u = validPublicUrl(url);
  if (!u) return { allowed: false, reason: 'url_invalida' };
  const origin = u.origin;
  let entry = robotsCache.get(origin);
  if (!entry || Date.now() - entry.time > (entry.deny ? 5 : 30) * 60 * 1000) {
    let r = await safeFetch(origin + '/robots.txt', { accept: 'text/plain', timeout: 4000, maxBytes: 300_000, deadline });
    // Servidor municipal lento não é recusa: uma segunda tentativa com mais tempo antes de suspender a leitura.
    if (!(typeof r.status === 'number') && !['dns_inexistente', 'ip_privado', 'dns_timeout'].includes(r.status)) {
      const left = deadline ? deadline - Date.now() - 3000 : 9000;
      if (left > 2500) r = await safeFetch(origin + '/robots.txt', { accept: 'text/plain', timeout: Math.min(9000, left), maxBytes: 300_000, deadline });
    }
    // 4xx = robots indisponível => permitido. 5xx/429/sem resposta => tratar como bloqueio total (RFC 9309, 2.3.1.3–2.3.1.4).
    let groups = [], deny = false, text = '';
    if (r.status === 200) { text = /<html/i.test(r.html || '') ? '' : String(r.html || ''); groups = parseRobots(text); }
    else if (typeof r.status === 'number' && r.status >= 400 && r.status < 500 && r.status !== 429) groups = [];
    else deny = true;
    entry = { time: Date.now(), groups, deny, status: r.status, text: text.slice(0, 1500) };
    robotsCache.set(origin, entry);
    if (robotsCache.size > 2000) robotsCache.delete(robotsCache.keys().next().value);
  }
  if (entry.deny) return { allowed: false, reason: ['dns_inexistente', 'ip_privado', 'dns_timeout'].includes(entry.status) ? entry.status : 'robots_indisponivel', detail: 'robots.txt respondeu ' + entry.status };
  const me = 'riolepubliccontactresearch';
  const specific = entry.groups.filter(g => g.agents.some(a => a && a !== '*' && me.startsWith(a)));
  const groups = specific.length ? specific : entry.groups.filter(g => g.agents.includes('*'));
  const path = u.pathname + u.search;
  const matched = groups.flatMap(g => g.rules).filter(r => ruleMatches(path, r)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  if (!matched.length || matched[0].allow) return { allowed: true };
  const agent = specific.length ? specific[0].agents.join(', ') : '*';
  return { allowed: false, reason: 'robots', detail: `regra "Disallow: ${matched[0].path}" para User-agent: ${agent}`, robotsText: entry.text };
}
