# Auditoria preliminar: padrões de sites das Câmaras Municipais

**Data:** 28/10/2026  
**Objetivo:** validar hipóteses técnicas ANTES de ampliar o rastreador para todas as UFs.

## Veredito

Não existe estrutura única. É viável cadastrar todas as instituições e descobrir grande parte das fontes públicas, mas **não é possível prometer acesso automatizado ou contatos completos para 100% dos sites**. A auditoria atual é exploratória, não um teste nacional realizado sobre todos os municípios.

O DF não tem municípios e possui a Câmara Legislativa do Distrito Federal, que deve ser tratado como instituição especial.

## Evidências de padrões diferentes

| Caso | Evidência | Implicação |
|---|---|---|
| Almirante Tamandaré/PR | Portal em `www.almirantetamandare.pr.leg.br` aponta para `sapl.almirantetamandare.pr.leg.br/parlamentar/` | Seguir links para subdomínios oficiais e usar API do SAPL quando confirmada |
| Abatiá/PR | Prefeitura em `www.abatia.pr.gov.br`; domínio legislativo associado a `abatia.pr.leg.br`; fonte alternativa GCAU lista presidente, telefone e e-mail | Prefeituras e Câmaras não são sinônimos; fallback oficial precisa funcionar |
| São Paulo/SP | `www.saopaulo.sp.leg.br` com portal próprio, diretório de vereadores e contatos | Não presumir SAPL |
| Campinas/SP | Site `www.campinas.sp.leg.br`, SAPL e transparência em subdomínios separados | Identificar múltiplas fontes por órgão |
| Areias/SP | Portal Modelo, SAPL e transparência Betha | Três conectores para uma Câmara |
| Quixadá/CE | `camaraquixada.ce.gov.br`, com rota `/parlamentares/` | Domínio e caminhos próprios |
| Manaus/AM | `www.cmm.am.gov.br` | Não pode depender de slug municipal em domínio |
| Belém/PA | `cmb.pa.gov.br`, perfis e contatos institucionais | Domínio abreviado |
| Recife/PE | `www.recife.pe.leg.br/lista-de-contatos` | Página de contato em rota particular |
| Itapoá/SC | Portal, SAPL e Atende.Net | Transparência terceirizada |
| Abatiá/PR (falha observada) | Robô mostrou `robots` no domínio `.leg.br` e timeouts em alternativas | Corrigir parser de robots e diagnosticar rede |

### Fontes examinadas

- Portal Modelo/Plone (Senado): https://www12.senado.leg.br/interlegis/produtos/portal-modelo/principais-caracteristicas
- SAPL (Senado): https://www12.senado.leg.br/interlegis/produtos/sapl
- Interlegis dúvidas e domínios: https://www12.senado.leg.br/interlegis/central-de-atendimento/solucao-de-problemas
- Cadastro de autoridades do Paraná: https://www.gcau-consulta.casacivil.pr.gov.br/gcau_internet/servicoLivreConsultaAgrupadorInternet.do?action=pesquisarPorAgrupadorInternet&codAgrupadorInternet=131
- Almirante Tamandaré (vereadores): https://www.almirantetamandare.pr.leg.br/processo-legislativo/vereadores
- Portal SAPL Almirante Tamandaré: https://sapl.almirantetamandare.pr.leg.br/parlamentar/
- Campinas (FAQ): https://www.campinas.sp.leg.br/ouvidoria/faq-perguntas-frequentes
- Quixadá: https://camaraquixada.ce.gov.br/parlamentares/
- Manaus (mapa do site): https://www.cmm.am.gov.br/mapa-site/
- Belém (vereadores): https://cmb.pa.gov.br/a-camara/vereadores/
- Itapoá (sistemas): https://www.camaraitapoa.sc.gov.br/perguntas-frequentes/893-o-site-e-o-portal-de-transparencia-contem-ferramenta-de-pesquisa-de-conteudo-que-permita-o-acesso-a-informacao.html
- RFC 9309: https://www.rfc-editor.org/rfc/rfc9309.html

## Situação dos defeitos (v0.5, 28/10/2026)

| # | Defeito | Situação |
|---|---|---|
| 1 | Domínios fora do padrão | Resolvido em grande parte: URLs vêm do cadastro Interlegis; heurísticas ampliadas; busca opcional com validação de identidade |
| 2 | `acceptedHost` bloqueava outros domínios oficiais | Resolvido: escopo pelo domínio validado + SAPL; redirecionamentos seguidos com revalidação |
| 3 | robots 4xx tratado como bloqueio | Resolvido (RFC 9309), com distinção entre "robots" e "robots_indisponivel" |
| 4 | Links avaliados só pela URL | Resolvido: texto do âncora e `title` entram na pontuação |
| 5 | Orçamento serverless | Mitigado: fila priorizada, 6 páginas em paralelo, DNS em cache, parada antecipada no modo rápido; `complete` só considera páginas relevantes pendentes |
| 6 | Sem persistência/fila | Aberto (progresso só no navegador) |
| 7 | SAPL não validado | Melhorado: paginação DRF, inativos filtrados, Mesa Diretora; validar contra SAPLs reais |
| 8 | PDFs, fontes externas por UF | Aberto (só GCAU/PR) |

## Defeitos confirmados na versão anterior (histórico)

1. `candidateDomains` reconhece apenas algumas construções de domínio. `cmm.am.gov.br`, `cmb.pa.gov.br` e outros padrões não são previstos.
2. `acceptedHost` bloqueia a exploração de outros domínios oficiais da mesma instituição que não correspondam ao padrão adivinhado.
3. `robotsAllowed` trata HTTP 401/403 do **robots.txt** como bloqueio absoluto. A RFC 9309, seção 2.3.1.3, considera 4xx no robots como *unavailable* (crawling pode ser permitido). Isso **não** autoriza ignorar 403 na própria página.
4. A verificação por substring em `title/body` e busca de links por palavras na URL ignora links relevantes quando o texto do âncora contém a informação e o href não.
5. `MAX_PAGES=55` e orçamento de 52 segundos por pesquisa em função serverless não permitem garantir varredura exaustiva.
6. Ainda não há persistência nem fila; uma pesquisa interrompida perde progresso.
7. A extração SAPL precisa ser testada por versão e endpoints reais. Alguns resultados podem depender de JavaScript; o endpoint assumido no código não foi validado para todos os SAPLs.
8. Não há extrator de documentos/PDFs, catálogo de fontes externas por UF nem verificação independente da qualidade dos registros.

## Arquitetura recomendada

1. **Catálogo:** municípios identificados por código IBGE; DF como exceção.
2. **Descoberta:** cadastro de domínios já verificados; diretórios do Senado; páginas de associação legislativa e fontes estaduais; pesquisa externa opcional, com validação de identidade da Câmara.
3. **Classificação:** detectar Plone/Portal Modelo, SAPL, WordPress/Joomla, plataformas proprietárias, terceiros de transparência, PDFs e páginas dinâmicas.
4. **Conectores:** priorizar APIs públicas e dados estruturados; depois HTML; renderizar JS sob demanda; PDFs com extração própria.
5. **Navegação:** fila persistente de URLs priorizadas, checkpoints, limites por domínio, backoff, política de acesso e observância de `robots.txt`.
6. **Dados:** preservar cargo, nome, e-mail e telefone institucional, URL e data de origem; não inferir contatos que faltam; deduplicar por pessoa+instituição, com histórico.
7. **Infra:** Next.js na Vercel para painel/API, PostgreSQL para histórico, workers fora da execução web de curta duração.
8. **Conformidade:** somente informações profissionais públicas pertinentes; retenção proporcional; canal de oposição/remoção e respeito a bloqueios.

## Protocolo de aceite antes do rollout

**Etapa 1** - bateria de portais de diferentes arquiteturas, UFs, tamanhos e condições de acesso, com comparação manual de contatos.

**Etapa 2** - diagnóstico exaustivo de uma UF piloto. Nenhum município pode desaparecer da lista por falta de domínio; cada um precisa de um estado `identificado / acessível / extraído / parcial / bloqueado / sem fonte / revisão`.

**Etapa 3** - expandir por lotes para as 26 UFs com municípios. Medir cobertura de descoberta, páginas efetivamente acessadas, precisão de nome/cargo/email/telefone, falsos positivos e percentuais sem informação pública.

**Critério de qualidade:** o painel distingue **instituições inventariadas** de **instituições acessadas**, **contatos verificados** de **contatos inferidos** (estes não devem ser publicados), e **varredura concluída** de **varredura limitada**.

**Nota de validação:** as observações acima vêm de páginas e índices públicos consultados em 28/10/2026, e não de uma execução ponta a ponta do crawler hospedado na Vercel.
