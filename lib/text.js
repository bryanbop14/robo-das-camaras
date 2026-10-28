// Funções puras, usadas no servidor e no navegador.

export const UFS = 'AC AL AP AM BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
export const UF_SET = new Set(UFS);

export function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Chave comparável de nome de município: sem acento, caixa, hífen, apóstrofo ou espaço. */
export function cityKey(value) {
  return stripAccents(value).toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function slug(value) {
  return cityKey(value);
}

export function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

/** Distância de edição limitada, para tolerar grafias como "Mogi-Mirim" x "Mogi Mirim" ou "Itaúna" x "Itauna do Sul". */
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Encontra o registro do índice para um município do IBGE. Exato primeiro; tolerância só quando não há ambiguidade. */
export function matchRegistry(entries, cityName) {
  const key = cityKey(cityName);
  if (!key || !entries?.length) return null;
  const exact = entries.filter(e => e.cityKey === key);
  if (exact.length) return exact[0];
  const near = entries
    .map(e => ({ e, d: editDistance(e.cityKey, key, 2) }))
    .filter(x => x.d <= (key.length > 8 ? 2 : 1))
    .sort((a, b) => a.d - b.d);
  if (near.length === 1 || (near.length > 1 && near[0].d < near[1].d)) return near[0].e;
  return null;
}

const DDD = new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);

/** Normaliza telefone brasileiro para "(DD) NNNN-NNNN" ou "(DD) 9NNNN-NNNN". Retorna '' se inválido. */
export function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return '';
  const ddd = Number(d.slice(0, 2));
  if (!DDD.has(ddd)) return '';
  const local = d.slice(2);
  if (local.length === 9 && local[0] !== '9') return '';
  if (local.length === 8 && !/[2-5]/.test(local[0])) return '';
  if (/^(\d)\1+$/.test(local)) return '';
  return `(${d.slice(0, 2)}) ${local.slice(0, local.length - 4)}-${local.slice(-4)}`;
}

const BAD_EMAIL_TLD = /\.(png|jpe?g|gif|svg|webp|css|js|pdf|docx?)$/i;
const PLACEHOLDER = /^(exemplo|example|seuemail|email|nome|usuario|user|teste|test)@|@(exemplo|example|dominio|domain|email)\./i;

export function cleanEmail(raw) {
  const e = String(raw || '').trim().replace(/^mailto:/i, '').split('?')[0].replace(/[.,;:)\]]+$/, '').toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return '';
  if (BAD_EMAIL_TLD.test(e) || PLACEHOLDER.test(e) || e.length > 90) return '';
  return e;
}

const FREE_MAIL = /@(gmail|hotmail|outlook|live|yahoo|bol|uol|terra|ig|globo|icloud|msn)\.(com|com\.br)(\.br)?$/;

/** Classifica o domínio do e-mail em relação à instituição. */
export function emailKind(email, officialHosts = []) {
  if (!email) return '';
  const domain = email.split('@')[1] || '';
  const base = h => String(h || '').toLowerCase().replace(/^www\./, '').replace(/^(sapl|transparencia|portal)\./, '');
  if (officialHosts.some(h => { const b = base(h); return b && (domain === b || domain.endsWith('.' + b) || b.endsWith('.' + domain)); })) return 'oficial';
  if (/\.leg\.br$|\.gov\.br$/.test(domain)) return 'governamental';
  if (FREE_MAIL.test(email)) return 'pessoal/gratuito';
  return 'outro domínio';
}

/** Pontos de prioridade comercial para a Riole (decisores e compras primeiro). */
export const SECTOR_PRIORITY = { decisor: 5, compras: 5, ti: 4, comunicacao: 4, mesa: 3, financeiro: 3, gestao: 2, parlamentar: 2, atendimento: 1, institucional: 1, '': 0 };
export const SECTOR_LABEL = { decisor: 'Decisor', compras: 'Compras/Licitação', ti: 'TI', comunicacao: 'Comunicação', mesa: 'Mesa Diretora', financeiro: 'Financeiro', gestao: 'Gestão', parlamentar: 'Parlamentar', atendimento: 'Atendimento', institucional: 'Institucional', '': '—' };

