import test from 'node:test';
import assert from 'node:assert/strict';
process.env.ROBO_TEST_ALLOW_LOCAL = '1';

const { REGISTRY_HTML, SITE, SAPL, serve } = await import('./fixtures.mjs');
const { parseEntries, registryLines, lastPage } = await import('../lib/registry.js');
const { extractContacts, relevantLinks, decodeCfEmail } = await import('../lib/extract.js');
const { matchRegistry, normalizePhone, cleanEmail, emailKind } = await import('../lib/text.js');
const { scanCamara } = await import('../lib/crawler.js');

test('cadastro Interlegis: entradas, serviços, filtros e paginação', () => {
  const entries = parseEntries(registryLines(REGISTRY_HTML), 'RJ');
  assert.deepEqual(entries.map(e => e.city), ['Valença', 'Volta Redonda']);
  const v = entries[0];
  assert.equal(v.cnpj, '39.756.648/0001-28');
  assert.equal(v.email, 'direcaocmv@gmail.com');
  assert.equal(v.sapl, 'https://sapl.valenca.rj.leg.br/');
  assert.equal(v.site, 'https://www.valenca.rj.leg.br/', 'Portal Modelo tem preferência e o href é lido mesmo com texto "acessar"');
  assert.match(v.address, /XV de Novembro/);
  const vr = entries[1];
  assert.equal(vr.phone, '(24) 4009-2266');
  assert.equal(vr.sapl, 'https://sapl.voltaredonda.rj.leg.br/', 'SAPL fora do ar ainda é registrado como candidato');
  assert.ok(!vr.services.some(s => /correio/.test(s.url)), 'E-mail Legislativo não é site');
  assert.equal(lastPage(REGISTRY_HTML, 'RJ'), 7, 'ignora links de filtro (servico=)');
  const go = parseEntries(registryLines(REGISTRY_HTML), 'GO');
  assert.equal(go.length, 1);
  assert.equal(go[0].cnpj, '');
});

test('correspondência de município IBGE x cadastro', () => {
  const entries = [{ cityKey: 'mogimirim' }, { cityKey: 'santabarbaradoeste' }, { cityKey: 'itauna' }, { cityKey: 'itaunadosul' }];
  assert.equal(matchRegistry(entries, 'Mogi Mirim'), entries[0]);
  assert.equal(matchRegistry(entries, "Santa Bárbara d'Oeste"), entries[1]);
  assert.equal(matchRegistry(entries, 'Itaúna'), entries[2]);
  assert.equal(matchRegistry(entries, 'Itaúna do Sul'), entries[3]);
  assert.equal(matchRegistry(entries, 'Curitiba'), null);
});

test('telefones e e-mails', () => {
  assert.equal(normalizePhone('+55 (42) 3222-1100'), '(42) 3222-1100');
  assert.equal(normalizePhone('042 99999-1234'), '(42) 99999-1234');
  assert.equal(normalizePhone('(00) 1234-5678'), '');
  assert.equal(normalizePhone('39756648000128'), '');
  assert.equal(cleanEmail('mailto:Fulano@Camara.SP.leg.br?subject=x'), 'fulano@camara.sp.leg.br');
  assert.equal(cleanEmail('logo@2x.png'), '');
  const hex = '42' + [...'a@b.co'].map(c => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
  assert.equal(decodeCfEmail(hex), 'a@b.co');
  assert.equal(emailKind('a@vilateste.pr.leg.br', ['www.vilateste.pr.leg.br']), 'oficial');
  assert.equal(emailKind('a@gmail.com', []), 'pessoal/gratuito');
  assert.equal(emailKind('a@prefeitura.pr.gov.br', ['x.pr.leg.br']), 'governamental');
});

test('extração: cartões, cargos, e-mail protegido e ofuscado', () => {
  const v = extractContacts(SITE['/a-camara/vereadores'], 'http://x/vereadores');
  const by = e => v.find(c => c.email === e);
  assert.equal(by('joao@vilateste.pr.leg.br').name, 'João da Silva Pereira');
  assert.equal(by('joao@vilateste.pr.leg.br').sector, 'decisor');
  assert.equal(by('joao@vilateste.pr.leg.br').phone, '(42) 3222-1101');
  assert.equal(by('maria@vilateste.pr.leg.br').name, 'Maria Aparecida Souza');
  assert.equal(by('carlos@vilateste.pr.leg.br').name, 'Carlos Alberto Lima');
  const est = extractContacts(SITE['/institucional/estrutura'], 'http://x/estrutura');
  const e = m => est.find(c => c.email === m);
  assert.equal(e('diretoria@vilateste.pr.leg.br').name, 'Ana Paula Martins');
  assert.equal(e('diretoria@vilateste.pr.leg.br').sector, 'decisor');
  assert.equal(e('pregao@vilateste.pr.leg.br').sector, 'compras');
  assert.equal(e('ti@vilateste.pr.leg.br').sector, 'ti');
  const fc = extractContacts(SITE['/fale-conosco'], 'http://x/fale');
  assert.ok(fc.some(c => c.email === 'contato@vilateste.pr.leg.br'), 'decodifica data-cfemail');
  assert.equal(fc.find(c => c.email === 'licitacao@vilateste.pr.leg.br').sector, 'compras');
});

test('links: usa texto do âncora, ignora notícias/PDF e prioriza telefones', () => {
  const links = relevantLinks(SITE['/'], 'http://x/', () => true).map(l => l.url);
  assert.ok(links.slice(0, 2).includes('http://x/servicos/telefones-uteis'));
  assert.ok(links.includes('http://x/institucional/estrutura'), '"Quem é quem" só aparece no texto do link');
  assert.ok(!links.some(l => /noticias|\.pdf/.test(l)));
});

test('varredura completa: cadastro + site + SAPL, robots e Mesa Diretora', async () => {
  const site = await serve(SITE);
  const sapl = await serve(SAPL);
  try {
    const r = await scanCamara('Vila Teste', 'PR', {
      fast: false,
      hint: { site: site.origin + '/', sapl: sapl.origin + '/', email: 'camara@gmail.com', phone: '(42) 3222-1100', cnpj: '11.222.333/0001-44' },
    });
    const by = e => r.contacts.find(c => c.email === e);
    assert.equal(r.officialSite, site.origin);
    assert.equal(r.saplUrl, sapl.origin);
    assert.match(r.platform, /Plone/);
    assert.equal(r.status, 'concluido', JSON.stringify(r.warnings));
    assert.ok(!by('secreto@vilateste.pr.leg.br'), 'respeita Disallow do robots.txt');
    assert.equal(by('joao@vilateste.pr.leg.br').role, 'Presidente (Mesa Diretora)');
    assert.equal(by('beatriz@vilateste.pr.leg.br').name, 'Beatriz Costa Ramos', 'perfil SAPL visitado quando a API não traz e-mail');
    assert.equal(by('beatriz@vilateste.pr.leg.br').role, '1º Secretário (Mesa Diretora)');
    assert.equal(r.platform, 'Portal Modelo (Plone)');
    assert.ok(!by('pedro@x.com'), 'parlamentar inativo ignorado');
    assert.ok(by('imprensa@vilateste.pr.leg.br'), 'telefones úteis visitado');
    assert.ok(by('camara@gmail.com'), 'contato do cadastro Interlegis preservado');
    assert.equal(r.contacts[0].priority, 5, 'decisores/compras primeiro');
    for (const c of r.contacts) assert.ok(c.confidence >= 0 && c.confidenceLabel);
  } finally { site.server.close(); sapl.server.close(); }
});

test('sem site: status coerente e contatos do cadastro', async () => {
  const r = await scanCamara('Lugar Nenhum', 'PR', { fast: true, hint: { email: 'cm@gmail.com' } });
  assert.equal(r.officialSite, '');
  assert.equal(r.status, 'fonte_alternativa');
  assert.equal(r.contacts.length, 1);
});

test('robots.txt: BOM, diagnóstico da regra e permissão', async () => {
  const { robotsCheck } = await import('../lib/net.js');
  const s = await serve({ '/robots.txt': '﻿User-agent: *\nDisallow: /privado\n\nUser-agent: Googlebot\nDisallow: /*?\n', '/': 'ok' });
  const blockAll = await serve({ '/robots.txt': 'User-agent: *\r\nDisallow: /\r\nUser-agent: Googlebot\r\nAllow: /\r\n' });
  try {
    assert.equal((await robotsCheck(s.origin + '/privado/x')).allowed, false, 'com BOM a regra ainda vale');
    assert.equal((await robotsCheck(s.origin + '/vereadores?x=1')).allowed, true, 'regra do Googlebot não se aplica a nós');
    const r = await robotsCheck(blockAll.origin + '/');
    assert.equal(r.reason, 'robots');
    assert.match(r.detail, /Disallow: \/" para User-agent: \*/);
    assert.match(r.robotsText, /Googlebot/);
  } finally { s.server.close(); blockAll.server.close(); }
});

test('coleta assistida: texto colado sem HTML', async () => {
  const { extractFromText, mergeContacts } = await import('../lib/extract.js');
  const text = `Mesa Diretora
Presidente
JOSÉ CARLOS DE OLIVEIRA
presidencia@abatia.pr.leg.br
(43) 3556-1487
Vereadora
Ana Lúcia Prado
ana.prado@abatia.pr.leg.br
Setor de Compras
licitacao@abatia.pr.leg.br - (43) 3556-2363`;
  const c = mergeContacts(extractFromText(text, 'https://www.abatia.pr.leg.br/vereadores').map(x => ({ ...x, type: 'manual' })), ['www.abatia.pr.leg.br']);
  const by = e => c.find(x => x.email === e);
  assert.equal(by('presidencia@abatia.pr.leg.br').name, 'José Carlos de Oliveira');
  assert.equal(by('presidencia@abatia.pr.leg.br').sector, 'decisor');
  assert.equal(by('presidencia@abatia.pr.leg.br').phone, '(43) 3556-1487');
  assert.equal(by('ana.prado@abatia.pr.leg.br').name, 'Ana Lúcia Prado');
  assert.equal(by('ana.prado@abatia.pr.leg.br').phone, '', 'não herda telefone do contato anterior');
  assert.equal(by('licitacao@abatia.pr.leg.br').sector, 'compras');
  assert.equal(by('licitacao@abatia.pr.leg.br').phone, '(43) 3556-2363');
  assert.equal(by('ana.prado@abatia.pr.leg.br').emailKind, 'oficial');
});

test('site bloqueado por robots: status bloqueado com a regra no diagnóstico', async () => {
  const s = await serve({ '/robots.txt': 'User-agent: *\nDisallow: /\n', '/': '<html><body>Câmara Municipal de Bloqueada</body></html>' });
  try {
    const r = await scanCamara('Bloqueada', 'PR', { fast: true, hint: { site: s.origin + '/', email: 'cm@gmail.com' } });
    assert.equal(r.status, 'bloqueado');
    assert.ok(r.attempts.some(a => /Disallow: \//.test(a.reason)));
    assert.match(r.robotsText, /Disallow/);
    assert.equal(r.blockedUrls.length, 1);
  } finally { s.server.close(); }
});

test('Softcam, Quadro Funcional, WhatsApp e múltiplos servidores com e-mail institucional único', async () => {
  const { mergeContacts } = await import('../lib/extract.js');
  const { extractPdfText } = await import('../lib/net.js');
  const zlib = await import('node:zlib');

  const submenuHtml = `
    <ul class="item-submenu">
      <li class="list-submenu-item"><a href="/camara/membros/show/58"><h4 class="list-title-avatar">Presidente</h4><p class="list-description">José Carlos de Oliveira (MDB)</p></a></li>
      <li class="list-submenu-item"><a href="/camara/membros/show/67"><h4 class="list-title-avatar">1º Secretário</h4><p class="list-description">Fernando Augusto Carvalho (PSD)</p></a></li>
      <li class="list-submenu-item"><a href="/camara/membros/show/65"><p class="list-description">Emerson Lourenço (PSD)</p></a></li>
    </ul>
    <footer>camaraabatia@gmail.com | Fone/Fax: (043) 3556 - 1487 3556.2363
      <a href="https://api.whatsapp.com/send?phone=5543998249129">WhatsApp</a>
    </footer>`;

  const extractedSub = extractContacts(submenuHtml, 'https://www.abatia.pr.leg.br/ajax/header_menu/Vereadores');
  const pdfStreamContent = 'BT\n1 0 0 1 50 700 Tm\n(QUADRO FUNCIONAL DO PODER LEGISLATIVO) Tj\n1 0 0 1 50 680 Tm\n(Maria Ines de Carvalho - Contador - Efetivo) Tj\n1 0 0 1 50 660 Tm\n(Reinaldo Junior - Advogado - Efetivo) Tj\nET';
  const compressed = zlib.deflateSync(Buffer.from(pdfStreamContent, 'latin1'));
  const fakePdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ' + compressed.length + ' >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  const pdfHtml = extractPdfText(fakePdf);
  assert.match(pdfHtml, /Maria Ines de Carvalho/);
  const extractedPdf = extractContacts(pdfHtml, 'https://www.cloudsoftcam.com.br/quadro-funcional.pdf', {
    fallbackEmail: 'camaraabatia@gmail.com',
    fallbackPhone: '(43) 3556-1487',
  });

  const merged = mergeContacts([...extractedSub, ...extractedPdf], ['www.abatia.pr.leg.br']);
  const byName = n => merged.find(c => c.name === n);
  assert.ok(byName('José Carlos de Oliveira'), 'extrai Presidente do submenu Softcam');
  assert.equal(byName('José Carlos de Oliveira').role, 'Presidente (Mesa Diretora)');
  assert.equal(byName('José Carlos de Oliveira').email, 'camaraabatia@gmail.com');
  assert.ok(byName('Fernando Augusto Carvalho'), 'preserva segundo membro mesmo compartilhando e-mail geral');
  assert.ok(byName('Emerson Lourenço'), 'extrai vereador em exercício');
  assert.ok(byName('Maria Ines de Carvalho'), 'extrai contadora do PDF de Quadro Funcional');
  assert.equal(byName('Maria Ines de Carvalho').role, 'Contador');
  assert.equal(byName('Maria Ines de Carvalho').sector, 'financeiro');
  assert.ok(byName('Reinaldo Junior'), 'extrai advogado do PDF de Quadro Funcional');
  assert.equal(byName('Reinaldo Junior').role, 'Advogado');
  assert.ok(merged.some(c => c.phone && (c.phone.includes('(43) 99824-9129') || c.phone.includes('(43) 3556-1487'))), 'extrai WhatsApp e telefone fixo');
});

test('bypassBlocks: contorna Disallow: / genérico em portais com crawlers sociais liberados, mantendo proteção a caminhos privados', async () => {
  const { robotsCheck } = await import('../lib/net.js');
  const s = await serve({
    '/robots.txt': 'User-agent: facebookexternalhit\nDisallow:\nUser-agent: *\nDisallow: /\n',
    '/': '<html><head><title>Câmara Municipal de Abatiá</title></head><body><h1>Câmara Municipal de Abatiá - Poder Legislativo Municipal</h1><p>Portal oficial de transparência, vereadores, sessões plenárias e atendimento ao cidadão: camaraabatia@gmail.com | Telefone: (43) 3556-1487</p></body></html>',
  });
  try {
    const allowedRoot = await robotsCheck(s.origin + '/', Date.now() + 5000, { bypassBlocks: true });
    assert.equal(allowedRoot.allowed, true, 'permite raiz pública via crawler social autorizado');
    const blockedAdmin = await robotsCheck(s.origin + '/admin/painel', Date.now() + 5000, { bypassBlocks: true });
    assert.equal(blockedAdmin.allowed, false, 'continua bloqueando caminhos sensíveis (/admin)');
    const r = await scanCamara('Abatiá', 'PR', { fast: true, bypassBlocks: true, hint: { site: s.origin + '/' } });
    assert.equal(r.status, 'concluido');
    assert.ok(r.contacts.some(c => c.email === 'camaraabatia@gmail.com'));
  } finally { s.server.close(); }
});

test('domínios abreviados (siglas RJ) e cartões multilinhas com departamentos', async () => {
  const { heuristicDomains } = await import('../lib/crawler.js');
  const bji = heuristicDomains('Bom Jesus do Itabapoana', 'RJ');
  assert.ok(bji.includes('https://cmbji.rj.gov.br'), 'gera sigla cmbji.rj.gov.br para Bom Jesus do Itabapoana');
  const dc = heuristicDomains('Duque de Caxias', 'RJ');
  assert.ok(dc.includes('https://www.cmdc.rj.gov.br'), 'gera sigla cmdc.rj.gov.br para Duque de Caxias');
  const cb = heuristicDomains('Cambuci', 'RJ');
  assert.ok(cb.includes('https://camaracambuci.rj.gov.br'), 'inclui variante sem www para Cambuci');

  const cmdcHtml = `
    <div class="pane">
      <p><strong>Presidente</strong><br>Claudio de Oliveira Thomaz<br>Telefone: (21) 2784-6935<br>Email: presidencia@cmdc.rj.gov.br</p>
      <p><strong>Controladoria Geral</strong><br>Amaury Lopes de Almeida Nogueira<br>Telefone: (21) 2784-6951<br>Email: controladoria@cmdc.rj.gov.br</p>
      <p><strong>Gabinete do Vereador Ailton Abreu Nascimento (Chiquinho Caipira)</strong><br>Telefone: (21) 2784-6961<br>E-mail: chiquinhocaipira@cmdc.rj.gov.br</p>
    </div>`;
  const contacts = extractContacts(cmdcHtml, 'https://www.cmdc.rj.gov.br/?page_id=6');
  const byEmail = e => contacts.find(c => c.email === e);
  assert.equal(byEmail('presidencia@cmdc.rj.gov.br').name, 'Claudio de Oliveira Thomaz');
  assert.equal(byEmail('controladoria@cmdc.rj.gov.br').name, 'Amaury Lopes de Almeida Nogueira');
  assert.equal(byEmail('chiquinhocaipira@cmdc.rj.gov.br').name, 'Ailton Abreu Nascimento');
});

test('descoberta inteligente: primeiro nome do município e domínio do e-mail institucional', async () => {
  const { heuristicDomains, domainsFromEmails } = await import('../lib/crawler.js');
  const alt = heuristicDomains('Altamira do Paraná', 'PR');
  assert.ok(alt.indexOf('https://www.camaraaltamira.pr.gov.br') > -1 && alt.indexOf('https://www.camaraaltamira.pr.gov.br') < 40, 'camaraaltamira.pr.gov.br entra na primeira onda');
  const fromMail = domainsFromEmails(['camara@cmadrianopolis.pr.gov.br', 'fulano@gmail.com', 'gabinete@pmadrianopolis.pr.gov.br']);
  assert.deepEqual(fromMail, ['https://www.cmadrianopolis.pr.gov.br', 'https://cmadrianopolis.pr.gov.br']);
});

test('Mesa Diretora em cartões "cargo + nome" (nos dois sentidos) e consolidação de e-mail pessoal', async () => {
  const { mergeContacts } = await import('../lib/extract.js');
  const nameFirst = `<title>Mesa Diretora</title><h1>Mesa Diretora</h1>
    <div><span>Sandro Junior dos Santos - União Brasil</span><b>PRESIDENTE</b></div>
    <div><span>Luiz Gonçalves da Silva - União Brasil</span><b>VICE-PRESIDENTE</b></div>
    <div><span>Ronaldo de Almeida Santos - PSD</span><b>1º SECRETÁRIO</b></div>
    <footer>camara@cmx.pr.gov.br (41) 3678-1515</footer>`;
  const a = extractContacts(nameFirst, 'https://cmx.pr.gov.br/?pag=mesa');
  const roleOf = (list, n) => list.find(c => c.name === n)?.role;
  assert.equal(roleOf(a, 'Sandro Junior dos Santos'), 'Presidente (Mesa Diretora)');
  assert.equal(roleOf(a, 'Luiz Gonçalves da Silva'), 'Vice-Presidente (Mesa Diretora)');
  assert.equal(roleOf(a, 'Ronaldo de Almeida Santos'), '1º Secretário(a) (Mesa Diretora)');

  const roleFirst = `<title>Câmara</title><h1>Conheça os integrantes da Mesa Diretora</h1>
    <div><span>PSD</span><b>Presidente</b><h3>SERGIO MESQUITA DE OLIVEIRA</h3><p>Saiba Mais</p></div>
    <div><span>PP</span><b>Vice-Presidente</b><h3>JOSE CARLOS DE SOUZA</h3><p>Saiba Mais</p></div>
    <div><span>PSD</span><b>2º Vice-Presidente</b><h3>VALDIRENE DA SILVA LEAL</h3></div>
    <footer>camara@cmy.pr.gov.br (44) 3755-1052</footer>`;
  const b = extractContacts(roleFirst, 'https://cmy.pr.gov.br/?meio=15521');
  assert.equal(roleOf(b, 'Sergio Mesquita de Oliveira'), 'Presidente (Mesa Diretora)');
  assert.equal(roleOf(b, 'Valdirene da Silva Leal'), '2º Vice-Presidente (Mesa Diretora)');

  const merged = mergeContacts([...b, { name: 'Serginho Boiadeiro', role: '', sector: '', email: 'sergiomesquitadeoliveira@gmail.com', phone: '', source: 'x', type: 'diretório' }], ['cmy.pr.gov.br']);
  const sergio = merged.find(c => c.name === 'Sergio Mesquita de Oliveira');
  assert.equal(sergio.email, 'sergiomesquitadeoliveira@gmail.com', 'e-mail pessoal ligado ao nome oficial');
  assert.ok(!merged.some(c => c.name === 'Serginho Boiadeiro'));
  assert.equal(plausibleNameOf('Evandro Gonçalves Pontes - Evandro Gonçalves Pontes - PSD'), 'Evandro Gonçalves Pontes');
  assert.equal(plausibleNameOf('Aumentar Fonte'), '');
});

const { plausibleName: plausibleNameOf } = await import('../lib/extract.js');

test('robô de atos oficiais: nomeações vigentes, função designada e exoneração posterior', async () => {
  const { extractActs, actRecords, actLinks } = await import('../lib/acts.js');
  const now = new Date('2026-06-01');
  const docs = [
    'PORTARIA Nº 015/2025 RESOLVE: Art. 1º NOMEAR o Senhor JOÃO CARLOS DA SILVA, portador do RG nº 1.234.567-8, para exercer o cargo em comissão de Diretor Geral, símbolo CC-1.',
    'Portaria nº 22/2025 - Nomeia Maria Aparecida dos Santos para o cargo de Assessora de Comunicação da Câmara Municipal.',
    'PORTARIA Nº 30/2025 RESOLVE: DESIGNAR a servidora ANA PAULA FERREIRA, ocupante do cargo efetivo de Oficial Administrativo, para exercer a função de Pregoeira.',
    'PORTARIA Nº 40/2026 RESOLVE: EXONERAR, a partir de 01/02/2026, o Sr. JOÃO CARLOS DA SILVA do cargo em comissão de Diretor Geral.',
    'Portaria 12/2019 Nomeia Carlos Antigo para o cargo de Contador.',
  ];
  const all = { appointments: [], dismissals: [] };
  for (const d of docs) { const r = extractActs(d, { now }); all.appointments.push(...r.appointments); all.dismissals.push(...r.dismissals); }
  const recs = actRecords(all, 'https://cm.x.gov.br/portarias', { fallbackEmail: 'camara@cm.x.gov.br' });
  const names = recs.map(r => r.name).sort();
  assert.deepEqual(names, ['Ana Paula Ferreira', 'Maria Aparecida dos Santos'], 'exonerado e ato antigo ficam de fora');
  assert.equal(recs.find(r => r.name === 'Ana Paula Ferreira').role, 'Pregoeira · Portaria 30/2025');
  assert.equal(recs.find(r => r.name === 'Ana Paula Ferreira').sector, 'compras');

  const listing = `<h1>Portarias</h1><a href="?ano=2026">2026</a><a href="?ano=2018">2018</a>
    <table><tr><td><a href="?id=10">0010-2026</a></td><td>Nomeia servidor para cargo em comissão</td></tr>
    <tr><td><a href="?id=11">0011-2026</a></td><td>Autoriza diária de viagem</td></tr></table>`;
  const links = actLinks(listing, 'https://cm.x.gov.br/portarias', () => true, { now });
  assert.ok(links.listings.some(l => l.url.endsWith('?ano=2026')));
  assert.ok(!links.listings.some(l => l.url.endsWith('?ano=2018')), 'anos antigos são ignorados');
  assert.ok(links.docs.some(d => d.url.endsWith('?id=10')));
  assert.ok(!links.docs.some(d => d.url.endsWith('?id=11')), 'diárias não são atos de pessoal');
});

test('endereço da Câmara: rodapé do site e reserva no cadastro', async () => {
  const { extractAddress, registryAddress } = await import('../lib/address.js');
  const html = `<html><body><h1>Câmara Municipal de Altamira do Paraná</h1>
    <p>Notícia: obras na Rua das Flores continuam.</p>
    <footer><div>fale conosco</div><div>(44) 3755-1052</div><div>camaraaltamira@camaraaltamira.pr.gov.br</div>
    <div>Localização</div><div>Rua Cantú, 180 - Centro - Altamira- - 85.280-000</div></footer></body></html>`;
  const a = extractAddress(html, 'https://www.camaraaltamira.pr.gov.br/', 'Altamira do Paraná');
  assert.equal(a.text, 'Rua Cantú, 180 - Centro - Altamira - 85.280-000');
  assert.equal(a.cep, '85280-000');
  const b = extractAddress('<footer>Av. Brasil, 200 | Fone: (44) 3232-1000 | CEP 87390-000</footer>', 'https://x/', 'Boa Esperança');
  assert.match(b.text, /^Av\. Brasil, 200/);
  assert.ok(!/Fone/.test(b.text), 'corta antes do telefone');
  const r = registryAddress({ address: 'Rua Rui Barbosa, 98, Barra do Jacaré - PR, 86385-000 Centro', cep: '86385-000' }, 'Barra do Jacaré', 'PR');
  assert.equal(r.cep, '86385-000');
  assert.match(r.text, /^Rua Rui Barbosa, 98 - Barra do Jacaré\/PR$/);
});

// ---------------- Vínculo contato × município (testes obrigatórios A–F + regressões) ----------------

const MARIOPOLIS = {
  '/robots.txt': 'User-agent: *\nAllow: /\n',
  '/': `<html><head><title>Página Inicial — Poder Legislativo Municipal</title></head><body>
    <header><img alt="Câmara Municipal de Mariópolis" src="/logo.png"><h1>Câmara Municipal de Mariópolis</h1></header>
    <p>Vereadores, sessões e transparência.</p>
    <footer>camara@mariopolis.pr.leg.br · (46) 3226-1111 · Rua Principal, 100 - Centro - Mariópolis/PR</footer></body></html>`,
};

test('A — busca por Carlópolis que cai numa página de Mariópolis não atribui o contato a Carlópolis', async () => {
  const site = await serve(MARIOPOLIS);
  try {
    // Simula o defeito antigo: o cadastro "parecido" indicava o site de Mariópolis para Carlópolis.
    const r = await scanCamara('Carlópolis', 'PR', { fast: true, hint: { site: site.origin + '/' } });
    assert.equal(r.officialSite, '', 'site de outro município não é aceito');
    assert.equal(r.status, 'site_nao_validado');
    assert.ok(!r.contacts.some(c => c.email === 'camara@mariopolis.pr.leg.br'), 'nenhum contato de Mariópolis em Carlópolis');
    assert.ok(r.attempts.some(a => /outro município/.test(a.reason || '')), 'motivo registrado na auditoria');
    // O mesmo site, pesquisado pela própria Mariópolis, é aceito com evidências.
    const own = await scanCamara('Mariópolis', 'PR', { fast: true, hint: { site: site.origin + '/' } });
    assert.equal(own.officialSite, site.origin);
    assert.ok(own.siteValidation.evidence.some(e => /Mariópolis/.test(e)));
    assert.ok(own.contacts.some(c => c.email === 'camara@mariopolis.pr.leg.br' && c.validation === 'VALIDADO'));
  } finally { site.server.close(); }
});

test('A2 — o cadastro só casa o MESMO município (sem trocar nomes parecidos)', () => {
  const entries = ['Mariópolis', 'Tapira', 'Guaporema', 'Mandaguaçu', 'Terra Roxa', 'Boa Esperança', 'Matelândia', "Diamante D'Oeste"]
    .map(city => ({ city, cityKey: city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') }));
  for (const c of ['Carlópolis', 'Janiópolis', 'Japira', 'Guapirama', 'Mandaguari', 'Terra Rica', 'Nova Esperança', 'Cafelândia']) {
    assert.equal(matchRegistry(entries, c), null, c + ' não pode herdar o cadastro de outro município');
  }
  assert.equal(matchRegistry(entries, 'Diamante do Oeste')?.city, "Diamante D'Oeste", 'mesma grafia sem apóstrofo continua casando');
});

test('B — e-mail do Tribunal de Contas em página da Câmara vira ORGAO_EXTERNO, não contato', async () => {
  const { classifyContact, externalInstitution } = await import('../lib/validate.js');
  const ctx = { city: 'Barbosa Ferraz', uf: 'PR', siteHosts: new Set(['cmbf.pr.gov.br']), siteValidated: true };
  const v = classifyContact({ email: 'presidencia@tce.pr.gov.br', role: 'Presidente', source: 'https://www.cmbf.pr.gov.br/index.php?meio=16037', type: 'setor' }, ctx);
  assert.equal(v.validation, 'ORGAO_EXTERNO');
  assert.match(v.reason, /tce\.pr\.gov\.br/);
  assert.ok(externalInstitution('mppr.mp.br'));
  assert.ok(externalInstitution('receita.fazenda.gov.br'));
  assert.equal(externalInstitution('cmbf.pr.gov.br'), '');
  // Fluxo completo: o e-mail aparece no site validado e sai da lista principal para "review".
  const site = await serve({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': '<html><head><title>Câmara Municipal de Barbosa Ferraz</title></head><body><h1>Câmara Municipal de Barbosa Ferraz</h1><p>Denúncias ao Tribunal de Contas: presidencia@tce.pr.gov.br</p><footer>falecom@cmbf.pr.gov.br (44) 3275-2241</footer></body></html>',
  });
  try {
    const r = await scanCamara('Barbosa Ferraz', 'PR', { fast: true, hint: { site: site.origin + '/' } });
    assert.ok(!r.contacts.some(c => c.email === 'presidencia@tce.pr.gov.br'));
    assert.ok(r.review.some(c => c.email === 'presidencia@tce.pr.gov.br' && c.validation === 'ORGAO_EXTERNO'));
    assert.ok(r.contacts.some(c => c.email === 'falecom@cmbf.pr.gov.br'));
  } finally { site.server.close(); }
});

test('B2 — e-mail do cadastro com domínio de outro município é SUSPEITO (erro de origem)', async () => {
  const { classifyContact } = await import('../lib/validate.js');
  const v = classifyContact({ email: 'contato@centenariodosul.pr.gov.br', type: 'cadastro-interlegis', source: 'https://www12.senado.leg.br/interlegis/orgaosatendidos?uf=PR' },
    { city: 'Jacarezinho', uf: 'PR', siteHosts: new Set(), siteValidated: false });
  assert.equal(v.validation, 'SUSPEITO');
  const ok = classifyContact({ email: 'contato@centenariodosul.pr.gov.br', type: 'cadastro-interlegis', source: 'https://www12.senado.leg.br/x' },
    { city: 'Centenário do Sul', uf: 'PR', siteHosts: new Set(), siteValidated: false });
  assert.equal(ok.validation, 'VALIDADO');
});

test('C — mesmo e-mail para Presidente e servidor na mesma Câmara: um registro, cargo estratégico', async () => {
  const { hygiene } = await import('../lib/validate.js');
  const { contacts, log } = hygiene([
    { name: 'Ana Souza', role: 'Assistente Administrativo', sector: 'gestao', email: 'camara@x.pr.gov.br', confidence: 80, validation: 'VALIDADO' },
    { name: 'João Lima', role: 'Presidente (Mesa Diretora)', sector: 'decisor', email: 'camara@x.pr.gov.br', confidence: 70, validation: 'VALIDADO' },
    { name: 'Câmara de X', nameGenerated: true, role: 'Contato institucional', email: 'camara@x.pr.gov.br', confidence: 50, validation: 'VALIDADO' },
  ]);
  const withEmail = contacts.filter(c => c.email === 'camara@x.pr.gov.br');
  assert.equal(withEmail.length, 1, 'um único registro com o e-mail');
  assert.equal(withEmail[0].name, 'João Lima', 'Presidente prevalece');
  const ana = contacts.find(c => c.name === 'Ana Souza');
  assert.equal(ana.email, '', 'servidora preservada, sem duplicar o e-mail');
  assert.equal(ana.sharedEmail, 'camara@x.pr.gov.br');
  assert.equal(ana.role, 'Assistente Administrativo', 'cargo não é inventado nem trocado');
  assert.ok(!contacts.some(c => c.nameGenerated), 'registro genérico duplicado removido');
  assert.equal(log.length, 2, 'decisões registradas');
});

test('D — Gmail publicado na página oficial validada é aceito', async () => {
  const { classifyContact } = await import('../lib/validate.js');
  const v = classifyContact({ email: 'camaraabatia@gmail.com', source: 'https://www.abatia.pr.leg.br/contato', type: 'diretório' },
    { city: 'Abatiá', uf: 'PR', siteHosts: new Set(['abatia.pr.leg.br']), siteValidated: true });
  assert.equal(v.validation, 'VALIDADO');
  const fora = classifyContact({ email: 'alguem@gmail.com', source: 'https://www.outrosite.com.br/x', type: 'busca' },
    { city: 'Abatiá', uf: 'PR', siteHosts: new Set(['abatia.pr.leg.br']), siteValidated: true });
  assert.equal(fora.validation, 'NAO_VALIDADO', 'fora do site validado não é confirmado');
});

test('E — municípios processados em paralelo não se contaminam', async () => {
  const mk = (city, mail) => ({
    '/robots.txt': 'User-agent: *\nAllow: /\n',
    '/': `<html><head><title>Câmara Municipal de ${city}</title></head><body><h1>Câmara Municipal de ${city}</h1><p>Portal oficial do Poder Legislativo: vereadores, sessões, transparência, ouvidoria e atendimento ao cidadão.</p><a href="/contato">Contato</a><footer>${mail} (44) 3000-0000</footer></body></html>`,
    '/contato': `<html><head><title>Contato - Câmara Municipal de ${city}</title></head><body><h1>Contato</h1><p>Presidente: Fulano de ${city.split(' ')[0]} Silva ${mail}</p></body></html>`,
  });
  const a = await serve(mk('Alfa Lindo', 'camara@alfalindo.pr.leg.br'));
  const b = await serve(mk('Beta Bonito', 'camara@betabonito.pr.leg.br'));
  try {
    const [ra, rb, ra2] = await Promise.all([
      scanCamara('Alfa Lindo', 'PR', { fast: true, hint: { site: a.origin + '/' } }),
      scanCamara('Beta Bonito', 'PR', { fast: true, hint: { site: b.origin + '/' } }),
      // Beta pesquisada com o site de Alfa por engano, ao mesmo tempo.
      scanCamara('Beta Bonito', 'PR', { fast: true, hint: { site: a.origin + '/' } }),
    ]);
    assert.ok(ra.contacts.every(c => !/betabonito/.test(c.email)) && ra.contacts.some(c => /alfalindo/.test(c.email)));
    assert.ok(rb.contacts.every(c => !/alfalindo/.test(c.email)) && rb.contacts.some(c => /betabonito/.test(c.email)));
    assert.ok(ra2.contacts.every(c => !/alfalindo/.test(c.email)), 'site de Alfa nunca é atribuído a Beta');
    assert.notEqual(ra.runId, rb.runId);
    for (const c of ra.contacts) { assert.equal(c.city, 'Alfa Lindo'); assert.equal(c.runId, ra.runId); }
  } finally { a.server.close(); b.server.close(); }
});

test('F — mesmo e-mail em fontes legítimas de dois municípios: preserva e sinaliza, sem escolher um', async () => {
  const { crossCheck } = await import('../lib/crosscheck.js');
  const shared = 'consorcio.legislativo@gmail.com';
  const results = [
    { id: 1, city: 'Alfa', officialSite: 'https://www.alfa.pr.leg.br', siteValidation: { evidence: [] }, contacts: [{ email: shared, role: 'Contato', source: 'https://www.alfa.pr.leg.br/contato', type: 'diretório', validation: 'VALIDADO' }] },
    { id: 2, city: 'Beta', officialSite: 'https://www.beta.pr.leg.br', siteValidation: { evidence: [] }, contacts: [{ email: shared, role: 'Contato', source: 'https://www.beta.pr.leg.br/fale', type: 'diretório', validation: 'VALIDADO' }] },
    // Contaminação: Gama recebeu o contato a partir de uma página de Alfa.
    { id: 3, city: 'Gama', officialSite: 'https://www.gama.pr.leg.br', siteValidation: { evidence: [] }, contacts: [{ email: shared, role: 'Contato', source: 'https://www.alfa.pr.leg.br/contato', type: 'diretório', validation: 'VALIDADO' }] },
  ];
  const { results: out, decisions } = crossCheck(results);
  assert.equal(out[0].contacts.length, 1);
  assert.equal(out[1].contacts.length, 1);
  assert.deepEqual(out[0].contacts[0].sharedAcross.sort(), ['Beta', 'Gama']);
  assert.equal(out[2].contacts.length, 0, 'vínculo de Gama (fonte de Alfa) removido');
  assert.ok(out[2].review.some(c => c.email === shared), 'removido vai para revisão, não some');
  assert.equal(decisions.filter(d => d.decisao === 'removido').length, 1);
  assert.equal(decisions.filter(d => d.decisao.startsWith('mantido')).length, 2);
});

test('F2 — resultados antigos com site de outro município são saneados e marcados para refazer', async () => {
  const { crossCheck } = await import('../lib/crosscheck.js');
  const { results: out, decisions } = crossCheck([
    { id: 9, city: 'Carlópolis', status: 'parcial', officialSite: 'https://www.mariopolis.pr.leg.br', saplUrl: 'https://sapl.mariopolis.pr.leg.br',
      contacts: [{ email: 'camara@mariopolis.pr.leg.br', source: 'https://www.mariopolis.pr.leg.br/', type: 'geral' },
        { email: 'cm@camaraclps.pr.gov.br', source: 'https://www.gcau-consulta.casacivil.pr.gov.br/x', type: 'cadastro-autoridades' }] },
  ]);
  assert.equal(out[0].status, 'site_nao_validado');
  assert.deepEqual(out[0].contacts.map(c => c.email), ['cm@camaraclps.pr.gov.br'], 'só o contato próprio (cadastro estadual) permanece');
  assert.ok(decisions.some(d => /não pertence a Carlópolis/.test(d.motivo)));
});
