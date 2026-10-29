'use client';
import { useMemo, useState } from 'react';
import { SECTOR_LABEL } from '../../lib/text.js';
import { PRIORITY_SECTORS } from '../lib/client.js';

const FILTERS = [
  ['todos', 'Todos'],
  ['prioritarios', 'Prioritários (decisor, compras, TI, comunicação)'],
  ['decisor', 'Decisores'],
  ['compras', 'Compras/Licitação'],
  ['ti', 'TI'],
  ['comunicacao', 'Comunicação'],
  ['parlamentar', 'Vereadores'],
  ['institucional', 'Institucional'],
];

export function filterContacts(contacts, { sector = 'todos', minConfidence = 0, officialOnly = false, query = '' }) {
  const q = query.trim().toLowerCase();
  return contacts.filter(c => {
    if (sector === 'prioritarios' && !PRIORITY_SECTORS.has(c.sector)) return false;
    if (sector === 'parlamentar' && !['parlamentar', 'mesa'].includes(c.sector)) return false;
    if (!['todos', 'prioritarios', 'parlamentar'].includes(sector) && c.sector !== sector) return false;
    if ((c.confidence || 0) < minConfidence) return false;
    if (officialOnly && c.emailKind !== 'oficial') return false;
    if (q && !`${c.city || ''} ${c.name} ${c.role} ${c.email} ${c.phone}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function ContactFilters({ value, onChange, total, shown }) {
  const set = patch => onChange({ ...value, ...patch });
  return <div className="filters">
    <div><label>Setor</label><select value={value.sector} onChange={e => set({ sector: e.target.value })}>{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
    <div><label>Confiança mínima</label><select value={value.minConfidence} onChange={e => set({ minConfidence: Number(e.target.value) })}>
      <option value={0}>Qualquer</option><option value={45}>Média ou alta</option><option value={70}>Somente alta</option></select></div>
    <div><label>Buscar</label><input value={value.query} placeholder="nome, cargo, e-mail…" onChange={e => set({ query: e.target.value })} /></div>
    <label className="check"><input type="checkbox" checked={value.officialOnly} onChange={e => set({ officialOnly: e.target.checked })} /> Só e-mail do domínio oficial</label>
    <span className="muted small">{shown} de {total} contatos</span>
  </div>;
}

export const DEFAULT_FILTERS = { sector: 'todos', minConfidence: 0, officialOnly: false, query: '' };

export default function ContactTable({ contacts, showCity = false, limit = 500, addressByCity = null }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const shown = useMemo(() => filterContacts(contacts, filters), [contacts, filters]);
  return <div>
    <ContactFilters value={filters} onChange={setFilters} total={contacts.length} shown={shown.length} />
    <div className="tablewrap"><table>
      <thead><tr>{showCity && <th>Município</th>}<th>Nome</th><th>Cargo / setor</th><th>E-mail</th><th>Telefone</th><th>Confiança</th><th>Fonte</th></tr></thead>
      <tbody>{shown.slice(0, limit).map((c, i) => <tr key={(c.email || c.phone) + i}>
        {showCity && <td>{c.city}{addressByCity?.[c.city] && <div className="muted small">{addressByCity[c.city]}</div>}</td>}
        <td>{c.name || <span className="muted">—</span>}</td>
        <td>{c.role || '—'}{c.sector && <div><span className={'tag tag-' + c.sector}>{SECTOR_LABEL[c.sector]}</span></div>}</td>
        <td>{c.email ? <a href={'mailto:' + c.email}>{c.email}</a> : '—'}{c.emailKind && <div className="muted small">{c.emailKind}</div>}</td>
        <td className="nowrap">{c.phone || '—'}</td>
        <td><span className={'conf conf-' + (c.confidenceLabel === 'média' ? 'media' : c.confidenceLabel)}>{c.confidence ?? '—'}</span></td>
        <td><a href={c.source} target="_blank" rel="noreferrer">{c.type || 'fonte'}</a></td>
      </tr>)}</tbody>
    </table></div>
    {shown.length > limit && <p className="muted small">Mostrando {limit} de {shown.length}. Exporte o CSV para ver todos.</p>}
    {!contacts.length && <p className="muted">Nenhum contato extraído. Isso não significa que a Câmara não publique contatos — veja a auditoria.</p>}
  </div>;
}
