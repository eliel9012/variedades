# Protocolo de sincronização offline-first

Este documento define a sincronização do dashboard Apura Brasil sem alterar a
interface pública de `ResultSnapshot` nem impedir a leitura do último estado
válido quando a rede falhar. O protocolo cobre o endpoint de resultados
`/data/results/latest.json`; o snapshot de candidatos (`/data/candidates.json`)
segue a mesma política de cache, mas não participa do placar.

## Objetivos e invariantes

- A tela sempre exibe o último snapshot válido disponível: remoto ou local.
- Um dado novo só substitui um dado anterior depois de passar por validação
  estrutural e semântica.
- Um snapshot oficial não é rebaixado para `waiting` por uma resposta vazia,
  erro de rede ou resposta mais antiga.
- A sincronização nunca bloqueia a renderização inicial.
- Requisições concorrentes para o mesmo recurso são evitadas; uma atualização
  manual durante um polling em andamento reaproveita a requisição ativa.
- O cliente não inventa votos nem altera `rows`, contagens ou timestamps.

## Estados do sincronizador

O estado operacional interno é separado de `ResultSnapshot.status`. A UI pode
continuar consumindo apenas `official`, `waiting` e `offline`.

| Estado | Entrada | Comportamento | Próxima ação |
| --- | --- | --- | --- |
| `boot` | carregamento da aplicação | Ler cache e iniciar listeners de conectividade; não aguardar rede para pintar a tela | `cached` se houver cache válido; caso contrário `waiting` |
| `cached` | cache válido carregado | Mostrar o snapshot local. Se não houver conectividade, marcar a leitura como `offline` sem apagar os dados | `polling` quando online; `offline` quando offline |
| `waiting` | nenhum snapshot remoto publicado | Manter a seleção atual e o snapshot de referência; mostrar “aguardando primeira publicação” | `polling` no próximo intervalo |
| `polling` | intervalo vencido ou ação “Atualizar dados” | Executar uma única requisição com timeout e `cache: no-store` | `applying`, `waiting`, `official`, `offline` ou `backoff` |
| `applying` | resposta válida recebida | Deduplicar, comparar versão e persistir somente se for mais nova | `official` ou `waiting` |
| `official` | snapshot oficial disponível | Exibir o último dado oficial e continuar verificando atualizações | `polling` no intervalo estável |
| `backoff` | timeout, erro HTTP, JSON inválido ou falha de validação | Preservar a última leitura e aguardar o próximo atraso calculado | `polling` |
| `offline` | `navigator.onLine === false` ou falha confirmada de rede | Suspender requisições automáticas, manter o cache e informar que ele é local | `polling` imediatamente após evento `online` |

O valor persistido em `ResultSnapshot.status` deve ser `official` para uma
resposta oficial aceita, `waiting` quando o servidor ainda não publicou dados
e `offline` somente para o estado exposto localmente enquanto não há rede. O
status `offline` é uma condição de leitura, não uma mutação permanente do
snapshot remoto salvo.

## Ciclo de polling

1. No boot, ler o cache antes da primeira chamada de rede.
2. Se houver rede, iniciar uma chamada imediatamente (sem esperar o primeiro
   intervalo).
3. Depois de cada conclusão, agendar apenas um próximo ciclo. O timer deve ser
   cancelado ao desmontar a aplicação e durante a transição para offline.
4. A chamada manual deve disparar o mesmo ciclo, zerar o contador de falhas e
   não criar um segundo timer.
5. Ao voltar para online, disparar uma chamada imediata, respeitando a trava de
   requisição em andamento.

### Intervalos

- Durante `waiting` ou enquanto o resultado ainda está mudando: **15 segundos**.
- Depois de um snapshot `official` sem alteração por três ciclos consecutivos:
  **60 segundos**.
- Depois de cinco minutos sem alteração e com a aplicação visível: manter **60
  segundos**; a aba em segundo plano pode usar **5 minutos** para reduzir
  consumo.
- Em `offline`: **nenhum polling**. O evento nativo `online` é o gatilho de
  retomada.
- Cada intervalo pode receber jitter aleatório de até **10%**, evitando que
  múltiplos clientes consultem o endpoint no mesmo instante.

O intervalo é contado a partir do fim da requisição, não do início. Assim,
uma resposta lenta não cria rajadas nem sobreposição de chamadas.

## Timeout e backoff

Cada tentativa usa `AbortController` com timeout de **8 segundos**. O timeout
inclui conexão e recebimento da resposta; ao expirar, a tentativa é abortada e
tratada como falha transitória.

Erros de rede, timeout, resposta HTTP fora de `2xx`, JSON inválido e falha de
validação usam backoff exponencial com teto:

| Falha consecutiva | Atraso base |
| ---: | ---: |
| 1 | 2 s |
| 2 | 4 s |
| 3 | 8 s |
| 4 | 16 s |
| 5 ou mais | 30 s |

Aplicar jitter de até 20% ao atraso de backoff. Uma resposta HTTP `401`, `403`
ou `404` não deve entrar em retry rápido: registrar o erro, preservar o cache e
usar o intervalo normal de 60 segundos (ou suspender até uma nova ação manual
se o recurso estiver definitivamente indisponível). Um `429` deve respeitar
`Retry-After` quando presente, limitado a 5 minutos.

Uma resposta válida zera o contador de falhas. O cache nunca é removido por uma
falha de rede; só é removido quando seu conteúdo não puder ser desserializado
ou não passar pela validação do contrato.

## Validação e deduplicação

Antes de aplicar uma resposta, validar:

- `election`, `scope` e `round` presentes;
- `round` igual a `1` ou `2`;
- `updatedAt` nulo ou timestamp ISO-8601 válido;
- `totalVotes`, `countedSections` e `totalSections` inteiros não negativos;
- `countedSections <= totalSections` quando `totalSections > 0`;
- `rows` como array, com `candidateId`, `votes` e `share` numéricos nos tipos
  esperados;
- `status` remoto igual a `official` ou `waiting`.

Calcular uma impressão determinística sobre o payload normalizado (por exemplo,
JSON canônico ordenado por `candidateId`) e guardar `fingerprint`. A resposta
é considerada duplicada quando tiver a mesma impressão da última aceita. Como
segunda proteção, comparar `updatedAt`:

- timestamp mais novo: aplicar;
- timestamp igual e impressão igual: ignorar silenciosamente;
- timestamp igual e impressão diferente: aceitar somente se a política de
  origem permitir correção do mesmo boletim; registrar a substituição;
- timestamp mais antigo: ignorar, salvo se não existir snapshot para o mesmo
  `election`, `round` e `scope`.

Quando `updatedAt` for `null`, usar a impressão do payload como versão. Nunca
substituir um snapshot `official` por um `waiting` sem versão mais nova e sem
mudança explícita de escopo/turno solicitada pelo usuário.

## Persistência em `localStorage`

Manter a chave já usada pelo dashboard para compatibilidade:

```text
apura-brasil:last-snapshot
```

O valor deve ser JSON contendo o `ResultSnapshot` aceito. Metadados de
sincronização podem ficar em uma chave separada:

```text
apura-brasil:last-snapshot-meta
```

Exemplo de metadados:

```json
{
  "fingerprint": "sha256:...",
  "savedAt": "2026-10-04T18:42:00.000Z",
  "source": "remote",
  "election": "2026",
  "round": 1,
  "scope": "BR"
}
```

Regras de escrita:

- escrever snapshot e metadados somente após a validação e a deduplicação;
- preferir uma única operação lógica de commit e tolerar falha de quota;
- nunca persistir erro, resposta parcial ou estado `offline` como se fosse uma
  nova leitura remota;
- se o JSON do cache estiver corrompido, remover as duas chaves e seguir em
  `waiting`/`offline`;
- ao ler cache de outro turno, escopo ou eleição, não misturá-lo ao placar
  atual; manter a associação nos metadados e buscar o recurso correto;
- aplicar a mesma estratégia ao cache de candidatos, usando uma chave própria
  (`apura-brasil:candidates`) e substituindo apenas um array completo e válido.

O cache local é uma cópia de leitura, não uma fila de escrita: o cliente nunca
faz upload de alterações ao servidor.

## Comportamento offline

Ao receber `offline`, parar o agendamento automático, manter o último snapshot
válido e expor `status: 'offline'` apenas na camada de apresentação. A mensagem
deve deixar claro que os números são o “último estado salvo localmente”. Filtros
de turno, território, cargo e busca continuam funcionando sobre os dados já
carregados; uma seleção sem dados não deve apagar o cache de outro recorte.

Enquanto offline:

- o botão de atualização pode ser acionado, mas deve falhar rapidamente sem
  tentar uma sequência de retries;
- não atualizar `updatedAt` nem o `fingerprint`;
- não trocar um snapshot oficial por `waiting` apenas porque não há conexão;
- manter candidatos em cache, se disponíveis, e usar a semente embutida como
  fallback final;
- ao receber `online`, aguardar a conectividade do navegador, fazer uma
  requisição imediata e voltar ao intervalo normal somente depois da conclusão.

Uma falha de requisição com `navigator.onLine === true` não prova que a rede
está indisponível; ela deve usar backoff e preservar o último estado. Só marcar
offline automaticamente após erro de transporte confirmado ou após o evento
`offline`, nunca por erro de conteúdo do servidor.

## Observabilidade mínima

Registrar em memória ou telemetria local apenas eventos técnicos sem dados
pessoais: início/fim da tentativa, duração, código HTTP, motivo da falha,
contador de backoff, tamanho do payload e resultado da deduplicação. Não
registrar nomes de candidatos, fotos ou o conteúdo integral do snapshot.

Critérios de aceite:

- recarregar sem rede mostra o último snapshot íntegro e o indicador offline;
- respostas repetidas não causam nova renderização nem nova escrita no cache;
- respostas antigas não sobrescrevem um snapshot mais novo;
- timeout encerra a requisição em até 8 segundos e respeita o backoff;
- voltar para online dispara uma única sincronização imediata;
- desmontar a tela não deixa timers ou requisições atualizando estado.
