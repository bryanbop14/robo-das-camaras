import * as cheerio from 'cheerio';
import { cityKey, stripAccents } from './text.js';

// Endereço físico da Câmara: lido do rodapé / página de contato do site oficial, com o cadastro Interlegis como reserva.

const STREET = /(?:^|[\s,:;(•|–-])((?:Rua|R\.|Avenida|Av\.?|Praça|Praca|Pça\.?|Pç\.|Travessa|Tv\.|Trav\.|Rodovia|Rod\.|Alameda|Al\.|Estrada|Largo|Vila|Via|Quadra|Setor|BR[- ]?\d{2,3}|PR[- ]?\d{2,3}|SC[- ]?\d{2,3}|RS[- ]?\d{2,3}|SP[- ]?\d{2,3}|MG[- ]?\d{2,3})\s+[A-Za-zÀ-ÿ0-9][^\n]{2,170})/gi;
const CEP = /\b(\d{2})\.?(\d{3})\s?-?\s?(\d{3})\b/;
const STOP = /\s*(?:\||•|Telefones?\s*:|Fones?\s*:|Tel\.?\s*:|E-?mail\s*:|CNPJ|Hor[áa]rio|Expediente|Atendimento\s*:|WhatsApp|Ouvidoria|Copyright|©|Todos os direitos|Desenvolvido|\(\d{2}\)\s*\d|\b\d{4,5}-\d{4}\b|[\w.-]+@[\w-]+\.)/i;

function clean(s) {
  return s.replace(/\s+/g, ' ').replace(/(\s*[-–,]\s*){2,}/g, ' - ').replace(/\s*[-–,;|]\s*$/, '').replace(/^\s*[-–,;|:]\s*/, '').replace(/\s+([,.])/g, '$1').trim();
}

/** Candidatos de endereço em um trecho de texto, já com CEP normalizado. */
export function addressCandidates(text) {
  const out = [];
  const flat = String(text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  STREET.lastIndex = 0;
  let m;
  while ((m = STREET.exec(flat))) {
    let chunk = m[1];
    // Corta no primeiro sinal de outra informação (telefone, e-mail, horário...); um CEP que venha depois é anexado.
    const cepIn = CEP.exec(chunk);
    const stop = STOP.exec(chunk);
    const end = stop ? stop.index : chunk.length;
    let cepText = '';
    if (cepIn && cepIn.index + cepIn[0].length > end && cepIn.index - end < 80) cepText = cepIn[0];
    chunk = chunk.slice(0, end);
    const cepKept = CEP.exec(chunk);
    if (cepKept && chunk.length > cepKept.index + cepKept[0].length + 40) chunk = chunk.slice(0, cepKept.index + cepKept[0].length + 40);
    if (!cepKept && cepText) chunk = clean(chunk) + ' - CEP ' + cepText;
    // Completa com o CEP logo em seguida, se vier separado ("... Centro. CEP 85280-000").
    let cep = CEP.exec(chunk);
    if (!cep) {
      const tail = flat.slice(m.index + m[0].length, m.index + m[0].length + 60);
      const after = /^\D{0,25}?(?:CEP\s*:?\s*)?(\d{2}\.?\d{3}\s?-?\s?\d{3})\b/i.exec(tail);
      if (after) { chunk += ' - CEP ' + after[1]; cep = CEP.exec(chunk); }
    }
    const textOut = clean(chunk).slice(0, 180);
    if (textOut.length < 10) continue;
    // Ruído típico: "Rua" em frases corridas, notícias etc.
    if (!/\d|s\/n|sem n[úu]mero/i.test(textOut)) continue;
    out.push({ text: textOut, cep: cep ? `${cep[1]}${cep[2]}-${cep[3]}` : '' });
  }
  return out;
}

/**
 * Melhor endereço de uma página: prioriza rodapé, blocos "endereço/contato/localização" e <address>.
 * Retorna { text, cep, score } ou null.
 */
export function extractAddress(html, url, city) {
  const $ = cheerio.load(String(html || ''));
  $('script,style,noscript,svg,iframe,nav').remove();
  $('br').replaceWith('\n');
  $('p,div,li,td,span,h1,h2,h3,h4,h5,h6,strong,b,a,address').each((_, el) => { $(el).append(' '); });
  const zones = [];
  $('footer, address, [class*=rodape], [id*=rodape], [class*=footer], [id*=footer], [class*=endereco], [id*=endereco], [class*=address], [class*=contato], [id*=contato], [class*=localiza], [itemprop=address]')
    .each((_, el) => zones.push({ text: $(el).text(), bonus: 3 }));
  const pageIsContact = /contato|fale|localiza|endere|atendimento|institucional|sobre/i.test(url || '');
  zones.push({ text: $('body').text(), bonus: pageIsContact ? 2 : 0 });
  const key = cityKey(city || '');
  let best = null;
  for (const z of zones) {
    for (const c of addressCandidates(z.text)) {
      const norm = stripAccents(c.text).toLowerCase().replace(/[^a-z0-9]/g, '');
      let score = z.bonus;
      if (c.cep) score += 3;
      if (/\b\d{1,5}\b|s\/n/i.test(c.text)) score += 2;
      if (key && norm.includes(key)) score += 2;
      if (/centro|bairro|jardim|vila|centro c[íi]vico/i.test(c.text)) score += 1;
      if (/prefeitura|secretaria municipal de|escola|hospital|unidade b[áa]sica|ubs\b/i.test(c.text)) score -= 4;
      if (c.text.length > 150) score -= 1;
      if (!best || score > best.score) best = { ...c, score };
    }
  }
  return best && best.score >= 4 ? best : null;
}

/** Endereço do cadastro Interlegis no mesmo formato (reserva quando o site não traz). */
export function registryAddress(hint, city, uf) {
  if (!hint?.address) return null;
  const base = clean(String(hint.address).replace(new RegExp(`,?\\s*${city}\\s*-\\s*${uf}\\b.*$`, 'i'), ''));
  const cep = (CEP.exec(hint.cep || '') || CEP.exec(hint.address) || []);
  return { text: `${base} - ${city}/${uf}`, cep: cep.length ? `${cep[1]}${cep[2]}-${cep[3]}` : '' };
}
