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
