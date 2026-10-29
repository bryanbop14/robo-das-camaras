import * as cheerio from 'cheerio';
import { cityKey, stripAccents } from './text.js';

// Identidade institucional: confirma que um site (ou um e-mail) pertence à Câmara do município pesquisado,
// combinando domínio, título, cabeçalho e textos institucionais — nunca um único sinal isolado.

const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'd']);
const HOST_PREFIX = /^(?:www\d?|sapl|portal|site|sistema|transparencia|camara(?:municipal)?(?:de|do|da|dos|das)?|cmv?|cam|cv|legislativo|leg|prefeitura|pm)(?=[a-z]{3,})/;
// Subdomínios genéricos à esquerda do nome (portal.cmX, transparencia.camaraX, cidadao.X, servicos.X).
const GENERIC_SUB = /^(?:www\d?|sapl|portal|site|sites|sistema|sistemas|transparencia|cidadao|servicos|esic|e-sic|ouvidoria|webmail|mail|intranet|novo|novoportal|app|online|leis|legislacao|diario|diariooficial)$/;

/** Partes do nome do município usadas para reconhecer abreviações de domínio. */
export function cityTokens(city) {
  const words = stripAccents(String(city || '')).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const sig = words.filter(w => !CONNECTORS.has(w));
  return { key: cityKey(city), words, sig, initials: sig.map(w => w[0]).join(''), initialsAll: words.map(w => w[0]).join('') };
}

/** Rótulo principal de um host, sem prefixos institucionais: "sapl.mariopolis.pr.leg.br" → "mariopolis"; "www.cmguairaca.pr.gov.br" → "guairaca". */
export function hostLabel(host) {
  const parts = String(host || '').toLowerCase().split('.');
  while (parts.length > 3 && GENERIC_SUB.test(parts[0])) parts.shift();
  const first = parts[0] || '';
  let label = first.replace(/-/g, '');
  for (let i = 0; i < 2; i++) label = label.replace(HOST_PREFIX, '');
  return { first: first.replace(/-/g, ''), label };
}

function isSubsequence(small, big) {
  let j = 0;
  for (const ch of big) if (ch === small[j]) j++;
  return j === small.length;
}

/**
 * Afinidade de um host com o município: 'propria' (há evidência), 'outra' (rótulo longo que claramente nomeia outro lugar),
 * 'indefinida' (sigla curta/genérica — não prova nem desmente).
 */
export function hostAffinity(host, city) {
  const t = cityTokens(city);
  const { first, label } = hostLabel(host);
  if (!label) return { level: 'indefinida', why: 'domínio sem rótulo' };
  const candidates = [label, first];
  for (const l of candidates) {
    if (!l) continue;
    if (t.key && (l === t.key || l.includes(t.key) || (t.key.length >= 6 && l.length >= 5 && t.key.startsWith(l)))) return { level: 'propria', why: `domínio "${host}" contém o nome do município` };
    // Uma palavra distintiva do nome, sozinha ("altamira" para Altamira do Paraná) — não basta só conter ("terra" ≠ Terra Roxa).
    if (t.sig.length > 1 && t.sig.some(w => w.length >= 5 && l === w)) return { level: 'propria', why: `domínio "${host}" usa "${l}", parte do nome do município` };
    if (l.length >= 2 && (l === t.initials || l === t.initialsAll)) return { level: 'propria', why: `domínio "${host}" usa a sigla do município` };
    // Abreviação por consoantes/letras na ordem ("clps" → Carlópolis, "wbraz" → Wenceslau Braz, "bssul" → Bom Sucesso do Sul).
    if (l.length >= 3 && t.key && l[0] === t.key[0] && isSubsequence(l, t.key)) return { level: 'propria', why: `domínio "${host}" é abreviação do município` };
    // Variação de grafia com conectivo a mais ("diamantedooeste" para Diamante D'Oeste).
    if (t.key.length >= 6 && l.length <= t.key.length + 3 && l[0] === t.key[0] && isSubsequence(t.key, l)) return { level: 'propria', why: `domínio "${host}" é variação do nome do município` };
  }
  // Rótulo longo (nome de cidade) sem relação com o município pesquisado.
  if (label.length >= 6) return { level: 'outra', why: `domínio "${host}" nomeia outro lugar ("${label}")` };
  return { level: 'indefinida', why: `sigla "${label}" não conclusiva` };
}

// Palavras fixas sem diferenciar maiúsculas; o nome do município precisa começar com maiúscula (evita capturar frases).
const DECLARED = /(?:[Cc][âÂaA][Mm][Aa][Rr][Aa])\s+(?:[Mm][Uu][Nn][Ii][Cc][Ii][Pp][Aa][Ll]\s+)?(?:[Dd][Ee]\s+[Vv][Ee][Rr][Ee][Aa][Dd][Oo][Rr][Ee][Ss]\s+)?(?:[Dd][EeOoAa][Ss]?)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’`´\-]+(?:[ \t]+(?:[Dd][AaEeOo][Ss]?[ \t]+|[Dd]['’][ \t]*)?[A-ZÀ-Ý][A-Za-zÀ-ÿ'’`´\-]+){0,3})/g;

/** Municípios que a página declara ser ("Câmara Municipal de X") no título, cabeçalho, logotipo e metadados. */
export function declaredMunicipalities(html) {
  const $ = cheerio.load(String(html || ''));
  const meta = ['og:site_name', 'og:title', 'application-name'].map(p => $(`meta[property="${p}"], meta[name="${p}"]`).attr('content')).filter(Boolean);
  $('script,style,noscript').remove();
  // Cada elemento separado por " | " (sem isso, textos vizinhos se colam: "MariópolisCâmara...").
  const textsOf = sel => $(sel).map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).join(' | ');
  const zones = [
    $('title').first().text(),
    ...meta,
    textsOf('.logo, [class*=brand], [class*=logo], [id*=logo], h1').slice(0, 4000),
    textsOf('header, #header, .header').slice(0, 4000),
    $('img[alt]').map((_, el) => $(el).attr('alt')).get().slice(0, 10).join(' | '),
    textsOf('footer, [class*=rodape], [id*=rodape]').slice(0, 3000),
  ].join(' \n ');
  const out = [];
  DECLARED.lastIndex = 0;
  let m;
  while ((m = DECLARED.exec(zones))) {
    const name = m[1].replace(/\s+(?:PR|SP|SC|RS|MG|RJ|BA|GO|MT|MS|PA|AM|CE|PE|PB|RN|AL|SE|PI|MA|TO|RO|AC|AP|RR|ES|DF)\b.*$/, '').replace(/[\s\-–]+$/, '').trim();
    const k = cityKey(name);
    if (k.length >= 3 && !/^(vereadores|municipal|legislativo|camara)$/.test(k)) out.push({ name, key: k });
  }
  return [...new Map(out.map(o => [o.key, o])).values()];
}

/** O nome declarado corresponde ao município? Aceita forma abreviada ("Altamira" para "Altamira do Paraná"). */
export function sameMunicipality(declaredKey, city) {
  const k = cityKey(city);
  if (!declaredKey || !k) return false;
  if (declaredKey === k) return true;
  // "Câmara Municipal de Mariópolis Poder Legislativo" → a declaração começa com o nome do município.
  if (k.length >= 4 && declaredKey.startsWith(k)) return true;
  const shorter = declaredKey.length < k.length ? declaredKey : k;
  const longer = shorter === k ? declaredKey : k;
  return shorter.length >= 5 && longer.startsWith(shorter);
}

/**
 * Verifica se a página pertence à Câmara do município. Retorna
 * { ok, conflict, evidence: string[], reason, declared: string[] }.
 * - conflito: a página/domínio identifica outro município → nunca aceita, mesmo vindo do cadastro.
 * - sem conflito: aceita se houver evidência positiva, ou se a fonte for confiável (cadastro oficial).
 */
export function verifyInstitution(html, url, city, { trusted = false } = {}) {
  const evidence = [];
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  const aff = host ? hostAffinity(host, city) : { level: 'indefinida' };
  const declared = declaredMunicipalities(html);
  const ours = declared.filter(d => sameMunicipality(d.key, city));
  const others = declared.filter(d => !sameMunicipality(d.key, city));
  if (aff.level === 'propria') evidence.push(aff.why);
  if (ours.length) evidence.push(`página declara "Câmara Municipal de ${ours[0].name}"`);
  if (trusted) evidence.push('endereço indicado por cadastro oficial');
  const body = stripAccents(cheerio.load(String(html || '')).root().text().slice(0, 30000)).toLowerCase().replace(/[^a-z0-9]/g, '');
  const mentions = cityKey(city) && body.includes(cityKey(city));
  if (mentions && !ours.length) evidence.push('nome do município aparece no conteúdo');

  if (others.length && !ours.length) {
    return { ok: false, conflict: true, evidence, declared: declared.map(d => d.name), reason: `Câmara de outro município (página declara "${others.map(o => o.name).join(', ')}")` };
  }
  if (aff.level === 'outra' && !ours.length && !(mentions && trusted)) {
    return { ok: false, conflict: true, evidence, declared: declared.map(d => d.name), reason: `Câmara de outro município (${aff.why})` };
  }
  const positive = aff.level === 'propria' || ours.length > 0 || mentions;
  if (!positive && !trusted) return { ok: false, conflict: false, evidence, declared: declared.map(d => d.name), reason: 'identidade do município não confirmada no site' };
  return { ok: true, conflict: false, evidence, declared: declared.map(d => d.name) };
}
