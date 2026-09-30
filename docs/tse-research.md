# Pesquisa TSE — Eleições 2026

Atualizado em **30/09/2026**. Pesquisa restrita a fontes oficiais do TSE e sua CDN. Nenhum código da aplicação foi alterado.

## Resumo executivo

- 1º turno: **04/10/2026**; eventual 2º turno: **25/10/2026**. Cargos: Presidente, Governador, Senador, Deputado Federal, Deputado Estadual/Distrital; há também Conselho Distrital de Fernando de Noronha no 1º turno.
- O acompanhamento em tempo real é público em `https://resultados.tse.jus.br` e os arquivos de integração são JWS compactos com payload JSON distribuídos pela CDN do TSE.
- Para candidatos, a fonte mais prática para ingestão offline é o Portal de Dados Abertos: arquivos ZIP com CSVs e fotos ZIP por UF/circunscrição.
- No momento da consulta, não havia pacote CKAN `resultados-2026`; portanto, resultados 2026 devem ser obtidos pela distribuição de arquivos do site Resultados. Não convém presumir um caminho/código de produção: obter `ele-c.jws`/`ele-c.json` primeiro.

## Calendário

- Página dinâmica: <https://www.tse.jus.br/eleicoes/calendario-eleitoral/calendario-eleitoral>
- Resolução oficial nº 23.760/2026: <https://www.tse.jus.br/legislacao/compilada/res/2026/resolucao-no-23-760-de-2-de-marco-de-2026>
- Página geral das Eleições 2026: <https://www.tse.jus.br/eleicoes/eleicoes-2026>

Datas operacionais principais para a aplicação: **04/10** (1º turno), **25/10** (2º turno onde houver) e disponibilidade dos dados de resultados até **04/04/2028**, conforme Resolução nº 23.751/2026.

## Apuração e resultados

Fontes:

- Resultados web: <https://resultados.tse.jus.br>
- Página de divulgação: <https://www.tse.jus.br/eleicoes/eleicoes-2026-content/divulgacao-dos-resultados-das-eleicoes-2026>
- Informações técnicas, limites e códigos: <https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados>
- Índice dos documentos de formato: <https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados>
- Instruções de download (PDF): <https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados/tse-instrucoes-para-download-dos-arquivos-da-divulgacao-2026>
- Resolução de atos gerais nº 23.751/2026: <https://www.tse.jus.br/legislacao/compilada/res/2026/resolucao-no-23-751-de-26-de-fevereiro-de-2026>

Ambiente oficial documentado:

- Host: `https://resultados.tse.jus.br`
- Ambiente: `oficial`
- Códigos publicados para 04/10/2026: `6257` (eleição federal), `6259` (eleições estaduais) e `6261` (Conselho Distrital).
- O ciclo, o código completo da eleição e os códigos de pleito devem ser lidos do arquivo de configuração `ele-c.jws`/`ele-c.json`; não hardcodear esses valores.

Hierarquia e formatos:

- `ele-c.jws` (EA11): configuração de eleições, ciclos, pleitos, abrangências, cargos e diretórios. O payload assinado é JSON.
- `mun-e<ELEICAO>-cm.json` (EA12): municípios; códigos TSE e IBGE.
- `br-e<ELEICAO>-ab.json` / `<uf>-e<ELEICAO>-ab.json` (EA14/EA15): acompanhamento Brasil/UF.
- `<escopo>-c<CCCC>-e<ELEICAO>-u.json` (EA20): resultado unificado; escopo pode ser Brasil, UF, município ou zona.
- `<br|uf>-c<CCCC>-e<ELEICAO>-e.json` (EA10): eleitos; pode não existir antes da primeira totalização final de UF (HTTP 404 é esperado antes da geração).
- Códigos de cargo documentados: Presidente `0001`, Governador `0003`, Senador `0005`, Deputado Federal `0006`, Deputado Estadual `0007`, Deputado Distrital `0008`.
- A estrutura também prevê arquivos de urna/BU, RDV, logs, assinaturas e fotos; usar apenas se a aplicação precisar de auditoria ou conferência de seção.

O modelo 2026 é bastante semelhante ao de 2024, mas o TSE recomenda seguir a documentação vigente. Os arquivos são JSON; há manual oficial para verificação de assinaturas JWS.

Para testes, o TSE publicou um ambiente simulado separado (não confundir com dados oficiais):

- Base: `https://resultados-sim.tse.jus.br/simulado`
- Ambiente/ciclo: `simulado2026`; pleito `17801`; eleições `21270` (federal), `21272` (estadual) e `21274` (municipal/conselheiro).
- Configuração: <https://resultados-sim.tse.jus.br/simulado/simulado2026/comum/config/ele-c.json>
- Acompanhamento Brasil: <https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026/21270/dados/br/br-e021270-ab.json>
- Resultado de Presidente: <https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026/21270/dados/br/br-c0001-e021270-u.json>
- Municípios: <https://resultados-sim.tse.jus.br/simulado/simulado2026/ele2026/21270/config/mun-e021270-cm.json>

## Candidatos e fotos

Portal de Dados Abertos: <https://dadosabertos.tse.jus.br/dataset/candidatos-2026>

API CKAN para descobrir recursos sem raspar HTML:

```text
https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-2026
```

Arquivos oficiais principais (todos ZIP):

- Candidatos: <https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip>
- Informações complementares: <https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand_complementar/consulta_cand_complementar_2026.zip>
- Bens: <https://cdn.tse.jus.br/estatistica/sead/odsele/bem_candidato/bem_candidato_2026.zip>
- Coligações: <https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_coligacao/consulta_coligacao_2026.zip>
- Vagas: <https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_vagas/consulta_vagas_2026.zip>
- Motivo da cassação: <https://cdn.tse.jus.br/estatistica/sead/odsele/motivo_cassacao/motivo_cassacao_2026.zip>
- Redes sociais: <https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip>
- Histórico de candidaturas: <https://cdn.tse.jus.br/estatistica/sead/odsele/historico_candidatura/historico_candidatura_2026.zip>
- Fotos: `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/foto_cand2026_<UF>_div.zip` (há `BR` para Presidente e uma entrada por UF).
- Consulta pública de candidaturas/contas: <https://divulgacandcontas.tse.jus.br/divulga/#/>

Leiaute observado no `leiame.pdf` do ZIP de candidatos:

- CSV por UF, `BR` e `BRASIL`; campos entre aspas, separados por ponto e vírgula, com terminador CRLF.
- Codificação **Latin-1**.
- `#NULO` significa vazio; em campos numéricos, o correspondente é `-1`. `#NE` significa não existente no sistema/base daquele ano; em campos numéricos, `-3`.
- Campos úteis para a aplicação incluem `SQ_CANDIDATO`, `NR_CANDIDATO`, `NM_CANDIDATO`, `NM_URNA_CANDIDATO`, `CD_CARGO`/`DS_CARGO`, `SG_UF`, `NR_PARTIDO`/`SG_PARTIDO`, `CD_SITUACAO_CANDIDATURA`/`DS_SITUACAO_CANDIDATURA` e `CD_SIT_TOT_TURNO`/`DS_SIT_TOT_TURNO`.
- As fotos do Portal de Dados Abertos são JPEG dentro de ZIPs; os nomes carregam o identificador do candidato e devem ser associados ao CSV pelos identificadores oficiais, sem depender de ordem de arquivo.
- O conjunto informa frequência de atualização de **4 vezes ao dia** e alerta que CSVs grandes excedem o limite de linhas do Excel; usar parser/BD apropriado.

## Limites, CORS e riscos operacionais

- Limite documentado para a CDN de resultados: **100 requisições/s por IP**; exceder pode bloquear por **10 minutos**, com renovação se a condição persistir.
- Muitos `404` também podem causar bloqueio; não há listagem de arquivos. Construir URLs somente a partir de `ele-c.json`, `mun-...` e arquivos de configuração.
- A CDN suporta `ETag` e `Last-Modified`; respostas `304` ainda contam no rate limit. Não há índice de arquivos previsto para identificar atualizações.
- EA14/EA15 podem orientar o polling dos EA20, mas timestamps e conteúdo podem chegar dessincronizados pela CDN.
- A documentação do TSE não promete uma política de CORS. Em teste empírico feito em 30/09/2026 no endpoint oficial de simulado, `curl` com `Origin` recebeu `Access-Control-Allow-Origin` e `Vary: Origin`; tratar isso como comportamento observado, não como contrato para produção. Preferir ingestão server-side/offline.
- Não é necessária whitelist/cadastro para consumir os arquivos públicos, observadas as regras técnicas e da Resolução nº 23.751/2026.

## Recomendações para ingestão offline

1. Fixar um `snapshot_at` e baixar os ZIPs via API CKAN/URLs de recursos; guardar URL, data/hora, tamanho, ETag/Last-Modified e SHA-256 do arquivo original.
2. Extrair em área temporária; converter Latin-1 para UTF-8 no pipeline e preservar o valor bruto quando necessário.
3. Tratar `#NULO`, `#NE`, `-1` e `-3` como estados distintos, não como `NULL` indistinto.
4. Carregar candidatos primeiro e usar `SQ_CANDIDATO` como chave de junção para fotos, bens, redes e resultados; manter histórico de snapshots porque registros/situações podem mudar.
5. Para resultados ao vivo, fazer bootstrap do `ele-c.json`, derivar somente os caminhos necessários, usar polling moderado com `ETag`/`Last-Modified` e backoff; nunca fazer varredura de URLs.
6. Após o fechamento, arquivar os JSONs finais, EA10/EA20, boletins/relatórios aplicáveis e os manifestos de checksum para reprodutibilidade offline.
