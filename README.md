# Robô das Câmaras — Riole

Ferramenta de descoberta de fontes e contatos institucionais públicos para prospecção B2G.

## Estado de implementação

MVP inicial com interface Next.js, seleção das 27 unidades federativas, municípios carregados da API pública do IBGE, consulta pontual por município, heurísticas de descoberta de cinco padrões de domínio, navegação limitada a páginas de contato/servidores/diretorias, registro de erros e exportação CSV com URL de origem.

**Não é ainda uma varredura estadual/nacional em lote.** Não existe fila de execução, banco de dados persistente, cobertura garantida de todos os portais, consulta a indexadores externos nem OCR de PDF. Campos não localizados permanecem vazios. Nomes ainda não são inferidos automaticamente. Portais que bloqueiam requisições automatizadas podem não retornar dados.

## Executar

```bash
npm install
npm run dev
```

Abrir http://localhost:3000.

## Publicar na Vercel

1. Em https://vercel.com/new, escolha **Import Git Repository** e selecione `bryanbop14/robo-das-camaras`.
2. Framework: Next.js; Root Directory: `./`; Build Command: `npm run build`.
3. Faça Deploy. O primeiro acesso carrega a lista municipal do IBGE.
4. Para uso comercial real, configure autenticação e banco persistente antes de armazenar históricos e contatos em escala.

## Arquitetura planejada para cobertura nacional

- **Catálogo:** municípios IBGE identificados por código, UF e nome.
- **Descoberta:** domínios conhecidos, listas institucionais oficiais, mecanismos de pesquisa com APIs licenciadas e verificação de identidade da Câmara.
- **Coleta:** conectores por CMS/fornecedor de portal, HTML, PDFs e fontes oficiais alternativas.
- **Fila:** jobs de município com idempotência, rate limiting, histórico, retentativas e checkpoint.
- **Infraestrutura:** Vercel para painel/API; worker dedicado para tarefas longas; PostgreSQL para instituições, fontes, contatos e auditorias.
- **Conformidade:** respeitar robots.txt e condições de uso; processar somente informações profissionais públicas pertinentes; manter fonte, data de verificação e procedimento de exclusão/oposição.

## Testes de aceitação essenciais

- Coronel Vivida/PR: `https://www.camaracoronelvivida.pr.gov.br/`
- Cruzeiro do Oeste/PR: `https://www.cmcruzeirodooeste.pr.gov.br/`
- Douradina/PR: `https://www.douradina.pr.leg.br/`

Esses domínios fazem parte dos candidatos heurísticos; resultado positivo de acesso/extração depende da resposta efetiva de cada servidor. Erros 403, 406 e 503 não devem ser confundidos com ausência da instituição.

## Observação de segurança

O endpoint aceita apenas UF e município e constrói os candidatos localmente. Não ofereça um parâmetro arbitrário de URL sem proteção contra SSRF e verificação de destinos privados. Limite acesso ao endpoint antes de abrir a aplicação publicamente.
