import { cleanEmail, cityKey, emailKind, normalizePhone, stripAccents, uniq } from './text.js';
import { detectRole, nameFromText, roleFromEmail } from './extract.js';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?55[\s-]*)?\(?0?\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}/g;

async function serper(q, key, ms = 4000) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'br', hl: 'pt-br', num: 10 }),
    });
    return r.ok ? (await r.json()).organic || [] : [];
  } catch { return []; } finally { clearTimeout(timer); }
}

/**
 * Contatos a partir do índice de um buscador (trechos já publicados), sem acessar o site bloqueado.
 * Só aceita e-mails do domínio oficial, ou trechos que citem a Câmara do município.
 */
export async function searchSnippets(city, uf, hosts = []) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { records: [], attempts: [{ url: 'busca indexada', status: 'desativada', reason: 'configure SERPER_API_KEY para usar trechos indexados quando o site bloquear' }] };
  if (!hosts.filter(Boolean).length) return { records: [], attempts: [{ url: 'busca indexada', status: 'ignorada', reason: 'sem domínio oficial validado: trechos de buscador não comprovam vínculo com a Câmara' }] };
  const main = hosts.find(Boolean);
  const queries = uniq([
    main && `site:${main} e-mail telefone`,
    main && `site:${main} vereadores presidente`,
    `"Câmara Municipal de ${city}" ${uf} e-mail telefone presidente`,
  ]);
  const results = (await Promise.all(queries.map(q => serper(q, key)))).flat();
  const target = cityKey(city);
  const records = [];
  for (const item of results) {
    const text = `${item.title || ''} — ${item.snippet || ''}`;
    let link = '';
    try { link = new URL(item.link).href; } catch { continue; }
    const norm = stripAccents(text).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const email of uniq((text.match(EMAIL_RE) || []).map(cleanEmail))) {
      // Só e-mails do domínio oficial VALIDADO deste município. Trechos que apenas citam o nome da cidade
      // (notícias do TCE, PNCP, cadastros com várias Câmaras) não comprovam vínculo e são ignorados.
      const kind = emailKind(email, hosts);
      if (kind !== 'oficial') continue;
      const byText = detectRole(text), byMail = roleFromEmail(email);
      records.push({
        name: nameFromText(text), role: byText.role || byMail.role || 'Contato (trecho indexado)',
        sector: byText.sector || byMail.sector || 'institucional',
        email, phone: uniq((text.match(PHONE_RE) || []).map(normalizePhone))[0] || '', source: link, type: 'busca',
      });
    }
  }
  return { records, attempts: [{ url: 'busca indexada (' + queries.length + ' consultas)', status: 200, reason: records.length + ' contato(s) em trechos indexados' }] };
}
