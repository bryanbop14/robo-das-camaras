'use client';
import { useMemo } from 'react';
import { download, hintFor, toCsv } from '../lib/client.js';

export default function RegistryPanel({ uf, cities, registry }) {
  const matched = useMemo(() => cities.map(c => ({ city: c, entry: hintFor(registry.entries, c.nome) })), [cities, registry.entries]);
  const found = matched.filter(m => m.entry);
  const withSite = found.filter(m => m.entry.site).length;
  const withSapl = found.filter(m => m.entry.sapl).length;
  const loading = registry.status === 'loading';

  function exportCsv() {
    const rows = [['UF', 'Município (IBGE)', 'Código IBGE', 'No cadastro', 'Órgão', 'CNPJ', 'Endereço', 'CEP', 'E-mail', 'Telefone', 'Site', 'SAPL', 'Fonte']];
    for (const { city, entry: e } of matched) rows.push([uf, city.nome, city.id, e ? 'sim' : 'não', e?.name, e?.cnpj, e?.address, e?.cep, e?.email, e?.phone, e?.site, e?.sapl, e ? e.registrySource : '']);
    download(toCsv(rows), `cadastro-interlegis-${uf.toLowerCase()}.csv`);
  }

  return <div className="registry">
    <div className="row spaced">
      <div>
        <div className="muted small">Índice oficial · Interlegis/Senado Federal</div>
        {loading && <strong>Carregando cadastro de {uf}: {registry.loaded}/{registry.pages || '?'} páginas…</strong>}
        {registry.status === 'error' && <strong className="error">Cadastro indisponível agora. A descoberta seguirá por padrões de domínio.</strong>}
        {registry.status === 'ready' && <strong>{found.length} de {cities.length} municípios com registro · {withSite} com site · {withSapl} com SAPL</strong>}
        {registry.failed > 0 && !loading && <div className="warn small">{registry.failed} página(s) do cadastro falharam; use “Atualizar” para completar.</div>}
      </div>
      <div className="row">
        <button className="secondaryBtn" disabled={loading || !registry.entries.length} onClick={exportCsv}>Cadastro CSV</button>
        <button className="secondaryBtn" disabled={loading} onClick={registry.reload}>Atualizar</button>
      </div>
    </div>
    {loading && <div className="progressTrack thin"><div style={{ width: (registry.pages ? 100 * registry.loaded / registry.pages : 5) + '%' }} /></div>}
  </div>;
}
