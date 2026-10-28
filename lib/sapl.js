import { robotsCheck, safeFetch } from './net.js';
import { cleanEmail, normalizePhone } from './text.js';
import { plausibleName } from './extract.js';

function listOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function getJson(url, deadline, attempts) {
  const rob = await robotsCheck(url, deadline);
  if (!rob.allowed) { attempts.push({ url, status: rob.reason }); return null; }
  const r = await safeFetch(url, { accept: 'application/json', timeout: 5000, deadline, maxBytes: 3_000_000 });
  if (r.status !== 200 || !r.json) { attempts.push({ url, status: r.status, reason: r.reason || (r.html ? 'resposta não-JSON' : '') }); return null; }
  return r.json;
}

/** Percorre a paginação DRF do SAPL (até `maxPages`), sem sair do host. */
async function getAll(url, deadline, attempts, maxPages = 4) {
  const host = new URL(url).host;
  const items = [];
  let next = url;
  for (let i = 0; i < maxPages && next && Date.now() < deadline - 2500; i++) {
    const data = await getJson(next, deadline, attempts);
    if (!data) break;
    items.push(...listOf(data));
    try { next = data.next && new URL(data.next).host === host ? data.next : null; } catch { next = null; }
  }
  return items;
}

/**
 * Lê vereadores ativos e a composição atual da Mesa Diretora pela API REST do SAPL 3.x.
 * Retorna { records, profileLinks, attempts, ok }.
 */
export async function collectSapl(origin, deadline) {
  const attempts = [];
  const records = [];
  const profileLinks = [];
  const api = origin.replace(/\/$/, '') + '/api/parlamentares';
  const people = await getAll(api + '/parlamentar/?page_size=100', deadline, attempts, 3);
  if (!people.length) return { records, profileLinks, attempts, ok: false };
  attempts.push({ url: api + '/parlamentar/', status: 200, reason: people.length + ' parlamentares na API do SAPL' });

  // Mesa Diretora da sessão legislativa vigente (falhas aqui não invalidam a lista de parlamentares).
  const mesa = new Map();
  try {
    if (Date.now() < deadline - 6000) {
      const [sessoes, cargos] = await Promise.all([
        getAll(api + '/sessaolegislativa/?page_size=100', deadline, attempts, 2),
        getAll(api + '/cargomesa/?page_size=100', deadline, attempts, 1),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const current = sessoes
        .filter(s => s.data_inicio && s.data_inicio <= today && (!s.data_fim || s.data_fim >= today))
        .sort((a, b) => String(b.data_inicio).localeCompare(String(a.data_inicio)))[0]
        || sessoes.sort((a, b) => String(b.data_inicio).localeCompare(String(a.data_inicio)))[0];
      const cargoName = new Map(cargos.map(c => [Number(c.id), String(c.descricao || c.nome || c.__str__ || '')]));
      if (current) {
        const comp = await getAll(api + '/composicaomesa/?sessao_legislativa=' + current.id + '&page_size=100', deadline, attempts, 2);
        for (const c of comp.filter(c => Number(c.sessao_legislativa) === Number(current.id) || c.sessao_legislativa === undefined)) {
          const cargo = cargoName.get(Number(c.cargo)) || (typeof c.cargo === 'string' ? c.cargo : '');
          if (cargo) mesa.set(Number(c.parlamentar), cargo);
        }
      }
    }
  } catch { /* SAPL antigo ou API restrita: segue sem a Mesa */ }

  for (const p of people.slice(0, 200)) {
    const id = Number(p.id);
    if (!id || p.ativo === false) continue;
    const source = origin.replace(/\/$/, '') + '/parlamentar/' + id;
    const name = plausibleName(p.nome_completo) || plausibleName(p.nome_parlamentar) || String(p.nome_parlamentar || p.nome_completo || '').trim();
    const email = cleanEmail(p.email || p.email_institucional);
    const phone = normalizePhone(p.telefone || p.telefone_celular || '');
    const cargo = mesa.get(id) || '';
    const isPres = /^presidente/i.test(cargo);
    const role = cargo ? cargo + ' (Mesa Diretora)' : 'Vereador(a)';
    const sector = isPres ? 'decisor' : cargo ? 'mesa' : 'parlamentar';
    if (name && (email || phone)) records.push({ name, role, sector, email, phone, source, type: 'api-sapl' });
    else profileLinks.push({ url: source, score: cargo ? 6 : 5, role, sector });
  }
  return { records, profileLinks, attempts, ok: true, mesa: mesa.size };
}
