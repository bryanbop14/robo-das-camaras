import { lookup } from 'node:dns/promises';
import net from 'node:net';
import zlib from 'node:zlib';

export const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const SOCIAL_AGENT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const MAX_BYTES = 2_500_000;
const DNS_TTL = 10 * 60 * 1000;
const dnsCache = new Map();
const originAgent = new Map();

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

async function readBufferCapped(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
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
  return Buffer.concat(chunks.map(c => Buffer.from(c)));
}

async function readCapped(response, maxBytes) {
  const buf = await readBufferCapped(response, maxBytes);
  if (!buf.length) return '';
  const type = response.headers.get('content-type') || '';
  const charset = /charset=([\w-]+)/i.exec(type)?.[1]?.toLowerCase();
  let text = buf.toString(charset && /8859|1252|latin/.test(charset) ? 'latin1' : 'utf8');
  if (!charset && text.includes('')) {
    const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(text)?.[1]?.toLowerCase();
    if (meta && /8859|1252|latin/.test(meta)) text = buf.toString('latin1');
  }
  return text;
}

/** Extrai texto diretamente de streams FlateDecode de um PDF em Node.js puro (sem dependências nativas). */
export function extractPdfText(buf) {
  const str = buf.toString('latin1');
  const lines = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(str))) {
    let dec;
    try { dec = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    if (!/Tj|TJ/.test(dec)) continue;
    let lastY = null;
    let currentLine = '';
    const tokRe = /(?:1\s+0\s+0\s+1\s+([\d.-]+)\s+([\d.-]+)\s+Tm)|(?:\[((?:[^\]\\]|\\.)*)\]\s*TJ)|(?:\(((?:[^)\\]|\\.)*)\)\s*Tj)/g;
    let t;
    while ((t = tokRe.exec(dec))) {
      if (t[2] !== undefined) {
        const y = Math.round(parseFloat(t[2]));
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = '';
        }
        lastY = y;
      } else {
        const raw = t[3] !== undefined ? t[3] : '(' + t[4] + ')';
        const strRe = /\(((?:[^)\\]|\\.)*)\)/g;
        let s;
        while ((s = strRe.exec(raw))) {
          currentLine += s[1]
            .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
            .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, ' ')
            .replace(/\\([()\\])/g, '$1');
        }
        currentLine += ' ';
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
  }
  return lines.join('\n').replace(/[ \t]+/g, ' ').trim();
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pdfTextToHtml(text, url) {
  const rows = text.split('\n').map(l => l.trim()).filter(Boolean);
  const trs = rows.map(r => `<tr><td>${escapeHtml(r)}</td></tr>`).join('\n');
  return `<!DOCTYPE html><html><head><title>Documento Oficial - ${escapeHtml(url)}</title></head><body><div class="pdf-document"><table>${trs}</table><pre>${escapeHtml(text)}</pre></div></body></html>`;
}

/** Converte Markdown retornado pelo Reader Proxy (r.jina.ai) em HTML navegável pelo Cheerio. */
export function readerMarkdownToHtml(md, url) {
  const raw = String(md || '');
  const titleMatch = /^Title:\s*(.+)$/m.exec(raw);
  const title = titleMatch ? titleMatch[1].trim() : 'Câmara Municipal';
  const bodyMd = raw.includes('Markdown Content:') ? raw.split('Markdown Content:', 2)[1] : raw;
  const htmlLines = bodyMd.split(/\r?\n/).map(line => {
    let l = escapeHtml(line.trim());
    if (!l) return '';
    // Converte links Markdown [texto](url "titulo") -> <a href="url" title="titulo">texto</a>
    l = l.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, '<img alt="$1" src="$2" title="$3" />');
    l = l.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, '<a href="$2" title="$3">$1</a>');
    l = l.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    if (/^#{1,4}\s+/.test(l)) {
      const level = Math.min(4, /^#+/.exec(l)[0].length);
      return `<h${level}>${l.replace(/^#{1,4}\s+/, '')}</h${level}>`;
    }
    if (/^\*\s+/.test(l)) return `<li>${l.replace(/^\*\s+/, '')}</li>`;
    return `<p>${l}</p>`;
  }).filter(Boolean).join('\n');
  return `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${htmlLines}</body></html>`;
}

function isBotChallenge(html) {
  const head = String(html || '').slice(0, 4000);
  return /<title>\s*(?:Bot Verification|Just a moment\.\.\.|Attention Required! \| Cloudflare|Security Check)\s*<\/title>|id=["']lsrecaptcha-form["']|Verifying that you are not a robot/i.test(head);
}

/**
 * GET seguro: só hosts públicos, até 4 redirecionamentos (cada um revalidado), corpo limitado.
 * Retorna { status, url (final), html|json|text, contentType, reason }.
 */
export async function safeFetch(rawUrl, { accept = 'text/html,application/xhtml+xml,application/pdf;q=0.8', timeout = 6000, maxBytes = MAX_BYTES, deadline, userAgent } = {}) {
  let current = validPublicUrl(rawUrl);
  if (!current) return { status: 'url_invalida', url: String(rawUrl) };
  const started = Date.now();
  const seenHops = new Set();
  const cookies = new Map();
  for (let hop = 0; hop < 6; hop++) {
    seenHops.add(current.href);
    const dns = await resolvePublic(current.hostname);
    if (!dns.ok) return { status: dns.status, url: current.href };
    const remaining = deadline ? Math.min(timeout - (Date.now() - started), deadline - Date.now()) : timeout - (Date.now() - started);
    if (remaining < 400) return { status: 'timeout', url: current.href };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    const ua = userAgent || originAgent.get(current.origin) || AGENT;
    const cookieHeader = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    try {
      const response = await fetch(current.href, {
        headers: {
          'user-agent': ua,
          accept,
          'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'upgrade-insecure-requests': '1',
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        redirect: 'manual', cache: 'no-store', signal: controller.signal,
      });
      const setCookies = response.headers.getSetCookie?.() || (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
      for (const sc of setCookies) {
        const kv = String(sc).split(';')[0]?.trim();
        const eq = kv ? kv.indexOf('=') : -1;
        if (eq > 0) cookies.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
      }
      if (response.status >= 300 && response.status < 400) {
        const next = validPublicUrl(new URL(response.headers.get('location') || '', current).href);
        try { await response.body?.cancel(); } catch {}
        if (!next) return { status: 'redirect_invalido', url: current.href };
        if (current.protocol === 'https:' && next.protocol === 'http:' && next.hostname === current.hostname && next.pathname !== current.pathname) {
          const upgraded = new URL(next.href);
          upgraded.protocol = 'https:';
          if (!seenHops.has(upgraded.href)) next.protocol = 'https:';
        }
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
      if (contentType.includes('pdf') || /\.pdf(\?|$)/i.test(current.pathname)) {
        const buf = await readBufferCapped(response, maxBytes);
        const pdfText = extractPdfText(buf);
        if (pdfText.length >= 20) {
          return { status: 200, url: current.href, html: pdfTextToHtml(pdfText, current.href), pdfText, contentType: 'application/pdf' };
        }
        return { status: 'pdf_sem_texto', url: current.href, contentType };
      }
      if (!contentType || /text\/|html|xml/.test(contentType)) {
        const text = await readCapped(response, maxBytes);
        if (isBotChallenge(text)) {
          return { status: 403, url: current.href, reason: 'captcha (verificação anti-robô)' };
        }
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

/** Fallback via r.jina.ai para contornar bloqueios de IP/WAF ou extrair texto de PDFs complexos. */
export async function fetchViaReader(rawUrl, { timeout = 9000, deadline } = {}) {
  if (TEST_MODE) return { status: 'erro', url: rawUrl };
  const u = validPublicUrl(rawUrl);
  if (!u) return { status: 'url_invalida', url: String(rawUrl) };
  const remaining = deadline ? Math.min(timeout, deadline - Date.now()) : timeout;
  if (remaining < 1200) return { status: 'timeout', url: u.href };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch('https://r.jina.ai/' + u.href, {
      headers: { 'user-agent': AGENT, accept: 'text/plain, text/markdown;q=0.9' },
      cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      return { status: response.status, url: u.href };
    }
    const md = await readCapped(response, MAX_BYTES);
    if (!md || md.length < 40 || /Title:\s*Bot Verification|Verifying that you are not a robot/i.test(md)) {
      return { status: 403, url: u.href, reason: 'bloqueado mesmo via reader proxy' };
    }
    return {
      status: 200,
      url: u.href,
      html: readerMarkdownToHtml(md, u.href),
      contentType: 'text/html',
      reason: 'lido via reader proxy (contorno de bloqueio/PDF)',
    };
  } catch (e) {
    return { status: classifyError(e), url: u.href, reason: e?.cause?.code || e.message };
  } finally { clearTimeout(timer); }
}

/**
 * Tenta buscar a URL diretamente; se bloquear por WAF/CAPTCHA/conexão, tenta com User-Agent alternativo
 * (facebookexternalhit, liberado em portais Softcam/LiteSpeed), fallback HTTP e Reader Proxy (r.jina.ai).
 */
export async function fetchWithFallback(url, options = {}) {
  const first = await safeFetch(url, options);
  if (first.status === 200) return first;

  const u = validPublicUrl(url);
  const canBypass = options.bypassBlocks !== false && !TEST_MODE;

  // 1) Se sofreu bloqueio (403/406/429/503/captcha) ou reset de conexão, tenta com SOCIAL_AGENT (liberado em Softcam/LiteSpeed).
  if (u && (BLOCKED_STATUS.has(Number(first.status)) || first.status === 'conexao') && originAgent.get(u.origin) !== SOCIAL_AGENT) {
    const retrySocial = await safeFetch(url, { ...options, userAgent: SOCIAL_AGENT });
    if (retrySocial.status === 200) {
      originAgent.set(u.origin, SOCIAL_AGENT);
      return { ...retrySocial, reason: 'lido com User-Agent compatível (WAF/LiteSpeed)' };
    }
  }

  // 2) Se falhou por TLS/conexão em https, tenta http.
  if (/^https:/i.test(url) && ['tls', 'conexao', 'erro'].includes(String(first.status))) {
    const second = await safeFetch(url.replace(/^https:/i, 'http:'), options);
    if (second.status === 200) return { ...second, reason: 'https falhou (' + first.status + '); lido via http' };
  }

  // 3) Se ainda falhar por bloqueio/conexão/PDF sem texto e o contorno estiver ativo, usa Reader Proxy.
  if (canBypass && (BLOCKED_STATUS.has(Number(first.status)) || ['tls', 'conexao', 'timeout', 'pdf_sem_texto'].includes(String(first.status)))) {
    const viaReader = await fetchViaReader(url, options);
    if (viaReader.status === 200) return viaReader;
  }

  return first;
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

const INTERNAL_DISALLOW = /^\/(admin|wp-admin|login|privado|interno|painel|sistema|intranet|ciga|legisbr|legisla|rfassessoria|legislarr)\b/i;

export async function robotsAllowed(url, deadline) {
  return (await robotsCheck(url, deadline)).allowed;
}

/** { allowed, reason }: reason = 'robots' (regra Disallow) ou 'robots_indisponivel' (servidor não respondeu o robots.txt). */
export async function robotsCheck(url, deadline, { bypassBlocks = false } = {}) {
  const u = validPublicUrl(url);
  if (!u) return { allowed: false, reason: 'url_invalida' };
  const origin = u.origin;
  let entry = robotsCache.get(origin);
  if (!entry || Date.now() - entry.time > (entry.deny ? 5 : 30) * 60 * 1000) {
    let r = await safeFetch(origin + '/robots.txt', { accept: 'text/plain', timeout: 4000, maxBytes: 300_000, deadline });
    if (!(typeof r.status === 'number') && !['dns_inexistente', 'ip_privado', 'dns_timeout'].includes(r.status)) {
      const left = deadline ? deadline - Date.now() - 3000 : 9000;
      if (left > 2500) r = await safeFetch(origin + '/robots.txt', { accept: 'text/plain', timeout: Math.min(9000, left), maxBytes: 300_000, deadline, userAgent: SOCIAL_AGENT });
    }
    let groups = [], deny = false, text = '';
    if (r.status === 200) {
      text = /<html/i.test(r.html || '') ? '' : String(r.html || '');
      groups = parseRobots(text);
      // Portais Softcam bloqueiam "*" mas liberam facebookexternalhit / Googlebot no robots.txt e no WAF LiteSpeed.
      const allowsSocial = groups.some(g => g.agents.some(a => /facebookexternalhit|twitterbot|googlebot/i.test(a)));
      if (allowsSocial) originAgent.set(origin, SOCIAL_AGENT);
    }
    else if (typeof r.status === 'number' && r.status >= 400 && r.status < 500 && r.status !== 429) groups = [];
    else deny = true;
    entry = { time: Date.now(), groups, deny, status: r.status, text: text.slice(0, 1500) };
    robotsCache.set(origin, entry);
    if (robotsCache.size > 2000) robotsCache.delete(robotsCache.keys().next().value);
  }
  const path = u.pathname + u.search;
  if (entry.deny) {
    const isDnsFail = ['dns_inexistente', 'ip_privado', 'dns_timeout'].includes(entry.status);
    if (bypassBlocks && !isDnsFail && !INTERNAL_DISALLOW.test(path)) {
      return { allowed: true, bypassed: true, reason: 'robots_indisponivel_contornado', detail: 'robots.txt indisponível (' + entry.status + '); leitura pública prosseguiu' };
    }
    return { allowed: false, reason: isDnsFail ? entry.status : 'robots_indisponivel', detail: 'robots.txt respondeu ' + entry.status };
  }
  const me = 'riolepubliccontactresearch';
  const specific = entry.groups.filter(g => g.agents.some(a => a && a !== '*' && me.startsWith(a)));
  const groups = specific.length ? specific : entry.groups.filter(g => g.agents.includes('*'));
  const matched = groups.flatMap(g => g.rules).filter(r => ruleMatches(path, r)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  if (!matched.length || matched[0].allow) return { allowed: true };
  const agent = specific.length ? specific[0].agents.join(', ') : '*';
  if (bypassBlocks && !INTERNAL_DISALLOW.test(path) && !INTERNAL_DISALLOW.test(matched[0].path)) {
    return {
      allowed: true,
      bypassed: true,
      reason: 'robots_contornado',
      detail: `regra "Disallow: ${matched[0].path}" para User-agent: ${agent} contornada para leitura de dados públicos`,
      robotsText: entry.text,
    };
  }
  return { allowed: false, reason: 'robots', detail: `regra "Disallow: ${matched[0].path}" para User-agent: ${agent}`, robotsText: entry.text };
}
