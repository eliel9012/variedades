# TSE — endpoint real de resultados das Eleições 2026

Pesquisa feita em **30/09/2026**, usando somente páginas e hosts oficiais do TSE. O objetivo desta nota é registrar o contrato publicado e o formato efetivamente servido pela CDN para apuração; não é uma recomendação para consumir endpoints presumidos.

## URL oficial e bootstrap

O site oficial de divulgação é [resultados.tse.jus.br](https://resultados.tse.jus.br/). A página técnica do TSE confirma:

- base: `https://resultados.tse.jus.br`;
- ambiente: `oficial`;
- ciclo, código da eleição e demais diretórios: obtidos pelo arquivo de configuração, e não hardcoded.

O aplicativo oficial carregou, em 30/09/2026, este bootstrap:

```text
https://resultados.tse.jus.br/oficial/comum/config/ele-c.jws
```

O sufixo real é **`.jws`**, embora o payload seja JSON. O JWS é compacto, com três segmentos (`header.payload.signature`), `alg: EdDSA` e `kid` no cabeçalho. O payload decodificado contém, entre outros, `dg`, `hg`, `f`, `idg`, `arq` e `pl`. Para 2026, a carga observada informou `ciclo = ele2026`, pleito `3220` e:

| Eleição | Código | 2º turno |
|---|---:|---:|
| Federal | `6257` | `6258` |
| Estadual | `6259` | `6260` |
| Conselho Distrital | `6261` | — |

Não use esses códigos como descoberta independente: leia o `ele-c.jws` vigente e valide a assinatura conforme o [manual oficial de verificação JWS](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados).

## Endpoint de resultado confirmado

O aplicativo oficial solicitou este arquivo para Presidente, Brasil, 1º turno:

```text
https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.jws
```

Esse arquivo retornou `HTTP 200` em 30/09/2026. A convenção observada é:

```text
https://resultados.tse.jus.br/oficial/<ciclo>/<cd_eleicao>/dados/<uf>/<escopo>-c<cd_cargo>-e<cd_eleicao_com_6_digitos>-u.jws
```

Use a convenção somente depois de obter os valores do `ele-c.jws` e dos documentos EA10–EA20 publicados pelo TSE. Não faça enumeração de caminhos: o TSE informa que não há listagem de arquivos e que múltiplos `404` podem bloquear o IP.

Os documentos vigentes estão no [índice de formatos de divulgação 2026](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados), e a página de [informações técnicas sobre a divulgação](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados) é a referência operacional para limites e atualização.

## Resposta real

Apesar de `Content-Type: application/json`, a resposta é um JWS compacto. O payload deve ser verificado criptograficamente antes de ser usado e, só depois, interpretado como JSON. Exemplo reduzido do payload decodificado observado:

```json
{
  "ele": "6257",
  "t": "1",
  "f": "o",
  "sup": "n",
  "tpabr": "br",
  "cdabr": "br",
  "dg": "29/09/2026",
  "hg": "19:25:59",
  "idg": "207544",
  "dv": "s",
  "tf": "n",
  "and": "n",
  "carg": [
    {
      "cd": "1",
      "nmn": "Presidente",
      "nmm": "Presidente",
      "nmf": "Presidente",
      "nv": "1",
      "agr": [
        {
          "n": "280001800617",
          "nm": "BRASIL PRONTO PRA MAIS",
          "tp": "c",
          "par": [
            {
              "n": "13",
              "sg": "PT",
              "cand": [
                {
                  "n": "13",
                  "sqcand": "280002542548",
                  "nm": "LUIZ INÁCIO LULA DA SILVA",
                  "nmu": "LULA",
                  "e": "n",
                  "vap": "0",
                  "pvap": "0,00"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Os valores numéricos e percentuais são frequentemente strings; preserve-os como strings no primeiro estágio. `dg`/`hg`/`idg` identificam a geração do arquivo, não devem ser confundidos com o horário local de recebimento.

## JSON/JWS versus CSV

Para apuração em tempo real, a fonte é a distribuição JSON assinada (`.jws`) acima. Não há um CSV de resultados ao vivo equivalente.

O CSV oficial de candidatos é uma fonte auxiliar, separada da apuração, distribuída no ZIP [consulta_cand_2026.zip](https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip). O pacote real observado continha arquivos por UF, `BR` e `BRASIL`; os CSVs usam campos entre aspas, separador `;`, terminador CRLF e codificação Latin-1. A primeira linha observada começa por:

```text
"DT_GERACAO";"HH_GERACAO";"ANO_ELEICAO";"CD_TIPO_ELEICAO";...;"SQ_CANDIDATO";"NR_CANDIDATO";"NM_CANDIDATO";...
```

Use `SQ_CANDIDATO`/`sqcand` para associar candidatos, fotos e resultados. O ZIP é adequado para carga/snapshot, não para polling de votos.

## CORS, cache e rate limit

### O que o TSE documenta

- Limite publicado: **100 requisições por segundo por IP**.
- Excesso pode causar bloqueio de **10 minutos**, renovado enquanto a condição persistir.
- Muitos `404` também podem provocar bloqueio; não há limiar público.
- Não há whitelist/cadastro previsto para os arquivos públicos.
- A CDN suporta `ETag` e `Last-Modified`; respostas `304` também contam no rate limit.
- Não há arquivo de índice para apontar atualizações. EA14/EA15 podem orientar quais abrangências mudaram, mas arquivos gerados em paralelo podem chegar dessincronizados.

### O que foi observado na CDN em 30/09/2026

No endpoint de resultado confirmado, a resposta incluiu:

```text
HTTP/2 200
content-type: application/json
cache-control: max-age=39..60
etag: "9b49a2fd2f4632af257db0ef70680121"
last-modified: Wed, 30 Sep 2026 01:52:49 GMT
x-ratelimit-limit: 2000, 2000;w=1
```

Com `Origin: https://example.invalid`, a CDN respondeu também:

```text
access-control-allow-origin: https://example.invalid
vary: Origin
```

Isso é comportamento observado, não promessa de compatibilidade futura. A documentação técnica do TSE não estabelece uma política de CORS. O header `x-ratelimit-limit: 2000` também não deve ser interpretado como autorização para exceder o limite documental de 100 req/s/IP.

Uma requisição condicional com `If-Modified-Since` retornou `304 Not Modified`. Nesta mesma verificação, `If-None-Match` retornou `200`; portanto, implemente os dois validadores, mas aceite tanto `200` quanto `304` e não dependa exclusivamente de ETag.

## Recomendação segura de polling/cache

1. Faça bootstrap no `ele-c.jws`, valide a assinatura e derive somente os arquivos necessários para o escopo escolhido.
2. Prefira ingestão server-side. Mesmo com CORS observado, não trate CORS como contrato público nem exponha a CDN diretamente a muitos clientes.
3. Para um único consumidor, use uma cadência conservadora de **30 s durante a apuração**; se `idg`/`dg`/`hg` não mudarem, aumente para **60–120 s**. Esses intervalos são recomendação operacional, não intervalo oficial do TSE.
4. Envie `If-Modified-Since` e `If-None-Match`, mantenha cache por URL e armazene o JWS bruto, o payload verificado, os headers, o horário de coleta e o hash SHA-256. `304` ainda consome quota.
5. Em `429`, `403`, `5xx` ou timeout, use exponential backoff com jitter, começando em 30 s e limitado a alguns minutos. Não repita imediatamente nem aumente concorrência.
6. Não faça varredura de UFs, cargos, municípios ou nomes de arquivo. Um `404` inesperado deve interromper a tentativa daquele caminho e ser diagnosticado contra a configuração/documentação, não ser repetido em loop.
7. Para reduzir tráfego, consulte primeiro os arquivos de acompanhamento EA14/EA15 e só repolle os EA20 necessários; aceite que a CDN pode entregar o acompanhamento antes do arquivo de resultado correspondente.
8. Arquive snapshots finais e os JWS brutos para reprodutibilidade. O arquivo EA10 de eleitos pode não existir antes da primeira totalização final de UF; `404` nesse caso é previsto pela documentação.

### Fontes oficiais

- [Resultados do TSE](https://resultados.tse.jus.br/)
- [Informações técnicas sobre a divulgação de resultados 2026](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados)
- [Índice dos documentos de formato da divulgação 2026](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/divulgacao-de-resultados)
- [Divulgação dos resultados das Eleições 2026](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/divulgacao-dos-resultados-das-eleicoes-2026)
- [Resolução TSE nº 23.751/2026](https://www.tse.jus.br/legislacao/compilada/res/2026/resolucao-no-23-751-de-26-de-fevereiro-de-2026)
- [Pacote oficial de candidatos 2026](https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip)
