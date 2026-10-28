'use client';
import { useState } from 'react';
import CityScan from './components/CityScan';
import StateSweep from './components/StateSweep';
import RegistryPanel from './components/RegistryPanel';
import { UFS } from '../lib/text.js';
import { useCities, useRegistry } from './lib/client.js';

export default function Home() {
  const [mode, setMode] = useState('city');
  const [uf, setUf] = useState('PR');
  const { cities, loading: citiesLoading, error } = useCities(uf);
  const registry = useRegistry(uf);

  return <main>
    <header>
      <div><div className="brand">RIOLE · INTELIGÊNCIA COMERCIAL</div><h1>Robô das Câmaras</h1>
        <p>Descoberta auditável de contatos institucionais das câmaras municipais brasileiras.</p></div>
      <span className="pill">v0.6 · 27 UFs</span>
    </header>

    <section className="panel">
      <div className="grid">
        <div><label>Estado</label><select value={uf} onChange={e => setUf(e.target.value)}>{UFS.map(x => <option key={x}>{x}</option>)}</select></div>
        <div className="alignEnd segmented">
          <button className={mode === 'city' ? '' : 'secondaryBtn'} onClick={() => setMode('city')}>Município</button>
          <button className={mode === 'state' ? '' : 'secondaryBtn'} onClick={() => setMode('state')}>Estado completo</button>
        </div>
      </div>
      <RegistryPanel uf={uf} cities={cities} registry={registry} />
      {error && <p className="error">{error}</p>}
    </section>

    <section className="panel">
      {mode === 'city'
        ? <CityScan uf={uf} cities={cities} citiesLoading={citiesLoading} registry={registry} />
        : <StateSweep uf={uf} cities={cities} citiesLoading={citiesLoading} registry={registry} />}
    </section>

    <section className="panel">
      <h2>Como funciona</h2>
      <p>1. O cadastro do Interlegis (Senado) indica CNPJ, contato institucional e os endereços oficiais (.leg.br, Portal Modelo e SAPL) de cada Câmara. 2. O robô valida o site, lê a API do SAPL (vereadores e Mesa Diretora), menus dinâmicos (como Softcam) e PDFs institucionais de Quadro Funcional, além de navegar por páginas de vereadores, contatos, estrutura, ouvidoria e links de WhatsApp, contornando bloqueios genéricos de firewall/WAF em portais públicos. 3. Cada contato recebe setor, prioridade comercial e uma nota de confiança. Contatos não são inferidos: tudo tem URL de origem.</p>
      <p className="muted small">Limites: até 60 páginas por município na pesquisa individual e 14 na varredura estadual; inclui extração nativa de PDFs de Quadro Funcional e fallback via Reader Proxy quando o servidor aplica desafios anti-bot.</p>
    </section>
  </main>;
}
