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
