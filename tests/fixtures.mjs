// Fixtures que imitam as estruturas reais observadas (cadastro Interlegis, portal de Câmara e API do SAPL).
import http from 'node:http';

export const REGISTRY_HTML = `<!doctype html><html><body>
<nav><a href="/interlegis">Interlegis</a></nav>
<div id="content">
 <div class="orgao">
  <h3><a href="https://www12.senado.leg.br/interlegis/orgaosatendidos/cm-valenca">Câmara Municipal de Valença</a></h3>
  <p>39.756.648/0001-28 - Câmara Municipal</p>
  <p>Pça. XV de Novembro, nº 676 Centro<br>27600-000 - Valença, RJ</p>
  <p><a href="mailto:direcaocmv@gmail.com">direcaocmv@gmail.com</a> - <a href="tel:"></a></p>
  <h4>Convênios</h4>
  <table><tr><th>Tipo de convênio</th><th>Número</th></tr><tr><td>Projeto Interlegis</td><td>33025</td></tr></table>
  <h4>Serviços Interlegis</h4>
  <table>
   <tr><th>Tipo de serviço</th><th>Data de instalação</th><th>URL de acesso</th><th>Última verificação</th><th></th><th>Última utilização</th></tr>
   <tr><td>SAPL</td><td>19/06/2018</td><td><a href="https://sapl.valenca.rj.leg.br/">https://sapl.valenca.rj.leg.br/</a></td><td>11/03/2024</td><td>Funcionando</td><td>02/05/2023</td></tr>
   <tr><td>Domínio .LEG.br</td><td>27/04/2017</td><td><a href="http://valenca.rj.leg.br">http://valenca.rj.leg.br</a></td><td>19/10/2026</td><td>Funcionando</td><td>-</td></tr>
   <tr><td>Portal Modelo</td><td>27/04/2017</td><td><a href="https://www.valenca.rj.leg.br/">acessar</a></td><td>11/03/2024</td><td>Funcionando</td><td>13/08/2021</td></tr>
  </table>
 </div>
 <div class="orgao">
  <h3>Assembleia Legislativa do Estado do Rio de Janeiro</h3>
  <p>30.449.862/0001-67 - Assembleia Legislativa</p>
  <p>Rua Primeiro de Março<br>20010-000 - Rio de Janeiro, RJ</p>
  <p><a href="mailto:alerj@alerj.rj.gov.br">alerj@alerj.rj.gov.br</a></p>
  <h4>Serviços Interlegis</h4>
  <table><tr><td>Domínio .GOV.br</td><td>01/01/2010</td><td>https://www.alerj.rj.gov.br</td><td>-</td><td>Funcionando</td></tr></table>
 </div>
 <div class="orgao">
  <h3>Câmara Municipal de Volta Redonda</h3>
  <p>32.517.906/0001-74 - Câmara Municipal</p>
  <p>AV. LUCAS EVANGELISTA OLIVEIRA FRANCO, Nº 511 ATERRADO<br>27215-630 - Volta Redonda, RJ</p>
  <p><a href="mailto:contato@voltaredonda.rj.leg.br">contato@voltaredonda.rj.leg.br</a> - <a href="tel:2440092266">(24) 4009-2266</a></p>
  <h4>Serviços Interlegis</h4>
  <table>
   <tr><td>Domínio .LEG.br</td><td>02/10/2013</td><td>http://voltaredonda.rj.leg.br</td><td>19/10/2026</td><td>Funcionando</td><td>-</td></tr>
   <tr><td>SAPL</td><td>11/06/2018</td><td>https://sapl.voltaredonda.rj.leg.br/</td><td>24/02/2026</td><td>Não funcionando</td><td>23/02/2026</td></tr>
   <tr><td>E-mail Legislativo</td><td>23/08/2019</td><td>https://correio.interlegis.leg.br/</td><td>-</td><td>Não verificado</td><td>-</td></tr>
  </table>
 </div>
 <div class="orgao">
  <h3>Câmara Municipal de Aragoiânia</h3>
  <p>Câmara Municipal</p>
  <p>Av. Alfredo Nasser, 544, Centro<br>75360-000 - Aragoiânia, GO</p>
  <p><a href="mailto:aragoianialegislativo@gmail.com">aragoianialegislativo@gmail.com</a></p>
 </div>
</div>
<div class="paginacao"><a href="https://www12.senado.leg.br/interlegis/orgaosatendidos?p=2&uf=RJ">2</a>
<a href="https://www12.senado.leg.br/interlegis/orgaosatendidos?p=7&uf=RJ" title="último">»</a>
<a href="https://www12.senado.leg.br/interlegis/orgaosatendidos?uf=RJ&servico=SAPL&p=99">SAPL 60</a></div>
</body></html>`;

function cf(email, key = 0x42) {
  return key.toString(16).padStart(2, '0') + [...email].map(c => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
}

const page = (title, body) => `<!doctype html><html><head><title>${title}</title><meta name="generator" content="Plone - http://plone.org"></head><body>
<header><h1>Câmara Municipal de Vila Teste</h1></header>
<nav><a href="/">Início</a> <a href="/a-camara/vereadores">Vereadores</a> <a href="/fale-conosco">Fale Conosco</a>
<a href="/institucional/estrutura">Quem é quem</a> <a href="/noticias/1">Notícias</a> <a href="/admin">Admin</a></nav>
<main>${body}</main>
<footer>Câmara Municipal de Vila Teste · Rua Central, 100 · <a href="tel:+554232221100">(42) 3222-1100</a></footer></body></html>`;

export const SITE = {
  '/robots.txt': 'User-agent: *\nDisallow: /admin\n',
  '/': page('Câmara Municipal de Vila Teste', `<p>Bem-vindo ao portal do Poder Legislativo de Vila Teste.</p>
    <a href="/servicos/telefones-uteis">Telefones úteis</a> <a href="/arquivo.pdf">Relatório</a>`),
  '/a-camara/vereadores': page('Vereadores', `<ul>
    <li class="card"><h3>JOÃO DA SILVA PEREIRA</h3><span>Presidente</span> <a href="mailto:joao@vilateste.pr.leg.br">e-mail</a> (42) 3222-1101</li>
    <li class="card"><h3>Maria Aparecida Souza</h3><span>Vereadora</span> maria [at] vilateste.pr.leg.br</li>
    <li class="card"><h3>Carlos Alberto Lima</h3><span>Vereador</span> <a href="/cdn-cgi/l/email-protection#${cf('carlos@vilateste.pr.leg.br')}">[email&#160;protected]</a></li>
   </ul>`),
  '/fale-conosco': page('Fale Conosco', `<p>Atendimento: <span class="__cf_email__" data-cfemail="${cf('contato@vilateste.pr.leg.br')}">[email protected]</span></p>
    <p>Licitações: licitacao@vilateste.pr.leg.br</p>`),
  '/institucional/estrutura': page('Estrutura', `<table>
    <tr><th>Setor</th><th>Responsável</th><th>Contato</th></tr>
    <tr><td>Diretoria Geral</td><td><strong>Ana Paula Martins</strong></td><td>diretoria@vilateste.pr.leg.br · (42) 3222-1102</td></tr>
    <tr><td>Pregoeiro</td><td><strong>Rafael Gomes Teixeira</strong></td><td>pregao@vilateste.pr.leg.br</td></tr>
    <tr><td>Informática</td><td><strong>Lucas Ferreira</strong></td><td>ti@vilateste.pr.leg.br</td></tr>
   </table>`),
  '/servicos/telefones-uteis': page('Telefones úteis', `<p>Comunicação / TV Câmara: imprensa@vilateste.pr.leg.br - (42) 3222-1110</p>`),
  '/admin': page('Admin', '<p>secreto@vilateste.pr.leg.br</p>'),
  '/noticias/1': page('Notícia', '<p>nada</p>'),
};

export const SAPL = {
  '/robots.txt': 'User-agent: *\nAllow: /\n',
  '/api/parlamentares/parlamentar/?page_size=100': { next: '__ORIGIN__/api/parlamentares/parlamentar/?page=2&page_size=100', results: [
    { id: 1, nome_parlamentar: 'João Pereira', nome_completo: 'João da Silva Pereira', email: 'joao@vilateste.pr.leg.br', telefone: '4232221101', ativo: true },
    { id: 2, nome_parlamentar: 'Inativo', nome_completo: 'Pedro Inativo Antigo', email: 'pedro@x.com', ativo: false },
  ] },
  '/api/parlamentares/parlamentar/?page=2&page_size=100': { next: null, results: [
    { id: 3, nome_parlamentar: 'Bia', nome_completo: 'Beatriz Costa Ramos', email: '', telefone: '', ativo: true },
  ] },
  '/api/parlamentares/sessaolegislativa/?page_size=100': { results: [
    { id: 10, data_inicio: '2025-01-01', data_fim: '2026-12-31' }, { id: 9, data_inicio: '2023-01-01', data_fim: '2024-12-31' },
  ] },
  '/api/parlamentares/cargomesa/?page_size=100': { results: [{ id: 1, descricao: 'Presidente' }, { id: 2, descricao: '1º Secretário' }] },
  '/api/parlamentares/composicaomesa/?sessao_legislativa=10&page_size=100': { results: [
    { parlamentar: 1, cargo: 1, sessao_legislativa: 10 }, { parlamentar: 3, cargo: 2, sessao_legislativa: 10 },
  ] },
  '/parlamentar/3': `<html><body><h1>Beatriz Costa Ramos</h1><p>Nome Completo: Beatriz Costa Ramos Partido: XYZ Telefone: (42) 3222-1103 E-mail: beatriz@vilateste.pr.leg.br</p></body></html>`,
};

export function serve(routes) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const origin = 'http://' + req.headers.host;
      const body = routes[req.url];
      if (body === undefined) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>404</h1>'); }
      if (typeof body === 'object') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(body).replaceAll('__ORIGIN__', origin));
      }
      res.writeHead(200, { 'content-type': req.url === '/robots.txt' ? 'text/plain' : 'text/html; charset=utf-8' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: 'http://127.0.0.1:' + server.address().port }));
  });
}
