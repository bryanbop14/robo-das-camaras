# Robô das Câmaras — Riole

Descoberta auditável de contatos institucionais públicos das câmaras municipais brasileiras, para prospecção B2G.

## O que faz (v0.5)

**1. Índice oficial por estado.** Ao escolher a UF, o painel carrega o cadastro de órgãos atendidos do Interlegis (Senado Federal) e associa cada Câmara ao município do IBGE. O cadastro traz CNPJ, endereço, e-mail e telefone institucionais e as URLs oficiais (domínio .leg.br, Portal Modelo, SAPL). Ele já pode ser exportado ("Cadastro CSV") antes de qualquer varredura, e fica em cache no navegador por 7 dias.

**2. Descoberta assertiva do site.** O robô testa primeiro as URLs do cadastro oficial e domínios conhecidos; só se falharem testa padrões de domínio (já filtrados por DNS) e, se houver `SERPER_API_KEY`, resultados de busca. A página precisa se identificar como Câmara — e, quando não vem do cadastro, como a Câmara daquele município (evita site da Prefeitura ou de outra cidade). Redirecionamentos entre domínios oficiais são seguidos; sites só em `http://` também são lidos.

**3. SAPL.** Lê a API REST do SAPL: vereadores ativos e a composição atual da Mesa Diretora (Presidente, Secretários). Perfis sem e-mail na API são visitados.

**4. Navegação priorizada.** Fila por relevância (avaliando o link *e o texto do âncora*): telefones úteis/ramais, quem é quem, vereadores, Mesa Diretora, contato, estrutura organizacional. Notícias, matérias, PDFs e áreas restritas são ignoradas. Até 6 páginas em paralelo.

**5. Extração.** Decodifica e-mails protegidos (Cloudflare `data-cfemail`, `mailto:`, “[at]”/“arroba”), lê telefones de links `tel:` e normaliza para `(DD) NNNN-NNNN` com DDD válido. Cada e-mail é associado ao "cartão" em volta dele (nome, cargo, telefone) sem misturar com o contato vizinho.

**6. Qualificação.** Cada contato recebe:
- **Setor:** Decisor (Presidente, Diretoria Geral/Administrativa), Compras/Licitação, TI, Comunicação, Mesa Diretora, Financeiro, Gestão, Parlamentar, Atendimento, Institucional. E-mails sem cargo são classificados pelo endereço (`licitacao@`, `ti@`, `presidencia@`…).
- **Prioridade comercial** (decisor e compras primeiro).
- **Confiança 0–100** (domínio do e-mail, nome, cargo, telefone, tipo de fonte) e o tipo de e-mail: oficial, governamental, pessoal/gratuito, outro domínio.

**7. Varredura do estado.** 1 a 4 municípios em paralelo, nova tentativa automática em erro, previsão de término, progresso salvo no navegador, **reprocessar pendentes**, filtro por situação e detalhes por município. Situações: concluído, parcial, bloqueado pelo site, site inacessível, só cadastro oficial, sem site localizado, erro.

**8. Quando o site recusa robôs.** O robô não contorna `robots.txt` nem bloqueios HTTP (não troca de identidade, de IP nem finge ser navegador). Em vez disso:
- mostra **a regra exata** que bloqueou (ex.: `Disallow: /` para `User-agent: *`) e o robots.txt do site, para separar bloqueio real de erro de leitura;
- trata robots.txt lento como lentidão: tenta de novo com mais tempo antes de suspender, e reavalia em 5 minutos;
- consulta **trechos indexados por buscador** (Serper, requer `SERPER_API_KEY`), aceitando só e-mails do domínio oficial ou trechos que citem a Câmara do município;
- oferece **coleta assistida**: atalhos para abrir as páginas no navegador da pessoa, que cola o conteúdo; o robô extrai e classifica sem acessar o site. Esses contatos sobrevivem a "Reprocessar pendentes".

**Exportações:** contatos (com setor, prioridade e confiança), câmaras (uma linha por município, com CNPJ, site, SAPL, plataforma e melhor contato), auditoria (cada tentativa e seu resultado) e cadastro oficial. Os CSVs usam `;` e BOM para abrir direto no Excel e neutralizam fórmulas.

## Executar

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # testes com fixtures locais (cadastro, site de Câmara e API SAPL simulados)
```

Variável opcional: `SERPER_API_KEY` (busca de domínios fora do padrão).

## Publicar na Vercel

1. Em https://vercel.com/new, **Import Git Repository** → `bryanbop14/robo-das-camaras`.
2. Framework Next.js, Root `./`, Build `npm run build`. Configure `SERPER_API_KEY` se quiser a busca.
3. As funções usam até 60 s (`maxDuration`); o plano Hobby limita a 60 s, suficiente para o modo rápido usado na varredura estadual.
4. Antes de abrir publicamente: proteja o painel com autenticação (os endpoints fazem requisições a terceiros).

## Segurança e conformidade

- O endpoint `/api/scan` recebe apenas UF, município e o registro do cadastro; URLs de dica só são aceitas em `.leg.br`/`.gov.br`. Toda requisição resolve o DNS e recusa IPs internos/privados, valida cada redirecionamento, limita o corpo a 1,5 MB e usa tempo máximo por página.
- `robots.txt` segue a RFC 9309: regras `Disallow` são respeitadas; 4xx no robots = permitido; 5xx/sem resposta = leitura suspensa ("robots_indisponivel"). Bloqueios 401/403/406/429/503 em páginas não são contornados — viram "bloqueado pelo site".
- Apenas contatos profissionais publicados pela própria instituição ou por cadastros oficiais, sempre com URL de origem. Nada é inferido.
- `ROBO_TEST_ALLOW_LOCAL=1` libera endereços locais **apenas** para a suíte de testes e é ignorado com `NODE_ENV=production`.

## Limites conhecidos

- PDFs e páginas montadas só por JavaScript não são lidos.
- Certificados TLS incompletos (comuns em sites públicos) fazem o robô tentar `http://`; se o site só aceita HTTPS, aparece como "site inacessível".
- A varredura estadual roda no navegador: fechar a aba pausa. Para execução contínua e histórico, o próximo passo é um worker com fila e PostgreSQL (ver `docs/AUDITORIA_PORTAIS.md`).
- Fontes estaduais complementares: hoje só o cadastro de autoridades do Paraná (GCAU), que traz o nome do Presidente.

## Testes de aceitação em produção

- Coronel Vivida/PR — `https://www.camaracoronelvivida.pr.gov.br/`
- Cruzeiro do Oeste/PR — `https://www.cmcruzeirodooeste.pr.gov.br/`
- Douradina/PR — `https://www.douradina.pr.leg.br/`
- Almirante Tamandaré/PR — portal + SAPL em subdomínio
- Manaus/AM e Belém/PA — domínios fora do padrão
