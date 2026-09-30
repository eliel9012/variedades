# QA de atualização automática da apuração

Casos de teste para a atualização automática do painel Apura Brasil. O foco é
confiança do dado, continuidade entre rede e cache e previsibilidade da
interface em desktop e mobile.

## Escopo e baseline

- Desktop: viewport de referência `1440 × 900`.
- Mobile: viewport de referência `390 × 844`, orientação retrato, zoom do
  navegador em 100%.
- Recortes: `Brasil / Presidente / 1º turno` e `Brasil / Presidente / 2º
  turno`.
- Dados de teste: pelo menos um snapshot oficial em cache, um lote posterior,
  um lote duplicado, um lote antigo, uma resposta `waiting`, erro HTTP `500`,
  timeout, JSON inválido e ausência de cache.
- Antes de cada caso, limpar apenas o estado do cenário: cache de snapshot,
  metadados de sincronização, service worker e requisições mockadas. Não usar
  dados de produção para validar resultados.

### Observações do app atual

Estas observações são o ponto de partida da revisão, não critérios aprovados:

- A atualização é acionada por `Atualizar dados` ou `Aplicar`; não há polling
  automático visível.
- O rodapé informa `Atualização manual por enquanto`.
- O cache usa o último snapshot local, mas a tela não exibe timestamp do dado,
  idade, fingerprint ou identificador do lote.
- O indicador `conectado/offline` existe no cabeçalho. Offline com cache é
  descrito como “último estado salvo localmente”; erro de rede não tem mensagem
  ou ação específica.
- O conteúdo inicial está em `waiting`, com zero seções e zero votos. O caso
  sem dados deve garantir que isso não seja interpretado como apuração zerada.

## Critérios gerais de aceite

1. Um snapshot válido mais novo substitui o anterior somente depois de
   validação; lote duplicado não reescreve cache nem gera anúncio repetido.
2. Um snapshot antigo, erro, timeout ou JSON inválido nunca apaga nem rebaixa o
   último snapshot válido.
3. Todo placar mostra, no mesmo contexto, status, timestamp absoluto, cobertura
   com numerador e denominador e fonte; `agora` sozinho não é suficiente.
4. Atualização mantém filtros, posição de scroll, foco e leitura dos números;
   não troca números existentes por spinner.
5. Offline informa claramente que o valor é local, desabilita ou explica ações
   que exigem rede e retoma uma única sincronização ao voltar para online.
6. Nenhum estado usa apenas cor, posição ou movimento para comunicar status.
7. Cada caso passa em desktop e mobile, salvo quando a matriz indicar uma
   verificação específica de layout ou interação.

## Matriz de casos

### ONLINE-01 — carregamento online sem cache

**Pré-condição:** navegador online; sem snapshot local; servidor responde um
snapshot válido `waiting` ou `official`.

**Passos:**

1. Abrir o app em desktop e repetir em mobile.
2. Observar o primeiro paint e a conclusão da primeira requisição.
3. Aguardar um intervalo de polling completo.

**Esperado:** a tela aparece sem bloquear a renderização; o estado inicial é
distinto de “zero votos”; o polling começa sem ação manual; status, timestamp,
cobertura e fonte ficam visíveis; uma resposta repetida não altera o layout.

**UX a verificar:** texto “aguardando publicação” deve ser diferente de “não
recebemos dados”; não deve haver salto de scroll, troca de filtros ou spinner
substituindo o placar.

### ONLINE-02 — atualização automática com dado oficial

**Pré-condição:** snapshot oficial em tela; servidor retorna um novo snapshot
com `updatedAt` posterior, mais seções e votos.

**Passos:**

1. Deixar o app aberto com um filtro e uma posição de scroll escolhidos.
2. Entregar o novo lote sem clicar em `Atualizar dados`.
3. Observar a transição e a área de status.

**Esperado:** o lote é aplicado automaticamente; o valor anterior permanece
visível durante a requisição; a UI sinaliza “Atualizando dados…” de forma não
bloqueante; números, cobertura, timestamp e status mudam juntos; foco, filtro e
scroll são preservados.

### LOTE-01 — lote novo, duplicado e concorrente

**Pré-condição:** snapshot A aceito; respostas mockadas A duplicada, B mais
novo e B repetido; polling e ação manual podem ocorrer próximos.

**Passos:**

1. Entregar A novamente.
2. Entregar B com `updatedAt` posterior.
3. Disparar polling e atualização manual quase simultaneamente.
4. Entregar B novamente.

**Esperado:** A duplicada é ignorada silenciosamente; B é aplicado uma vez;
requisições concorrentes são deduplicadas ou reaproveitam a mesma promessa;
cache e metadados são escritos uma vez; não há dois toasts, duas falas de
leitor de tela ou oscilação de números.

### STALE-01 — resposta antiga não sobrescreve a atual

**Pré-condição:** cache/tela com snapshot B; servidor retorna snapshot A com
`updatedAt` anterior, ou resposta atrasada de uma requisição iniciada antes.

**Passos:**

1. Manter B visível.
2. Entregar A depois de B.
3. Repetir em desktop e mobile, inclusive com a aba voltando do background.

**Esperado:** B continua na tela e no cache; a resposta antiga é descartada;
o usuário recebe “dados podem estar desatualizados” somente se a idade exceder
a janela definida; a mensagem mostra último horário recebido e ação `Tentar
novamente`. O status não volta de `official` para `waiting` sem mudança
explícita de recorte/turno.

### OFFLINE-01 — perda de rede com cache válido

**Pré-condição:** snapshot oficial com timestamp conhecido já carregado; app
online; simular evento `offline`.

**Passos:**

1. Perder conectividade sem recarregar a página.
2. Observar cabeçalho, faixa de estado e placar.
3. Clicar em `Atualizar dados`.
4. Alterar território, cargo, busca e turno sobre os dados já carregados.

**Esperado:** os números permanecem; aparece faixa persistente “Sem conexão —
mostrando dados recebidos às [hora]”; não há polling, retry em rajada ou
mudança de `updatedAt`; a ação manual falha rápido e explica que requer rede;
filtros locais continuam funcionando sem misturar outro recorte.

### OFFLINE-02 — abertura sem cache e retorno da rede

**Pré-condição:** sem cache; abrir offline; depois emitir `online` e fornecer
uma resposta válida.

**Passos:**

1. Abrir desktop e mobile offline.
2. Verificar o estado vazio/offline.
3. Restabelecer a conexão.
4. Observar a primeira sincronização e o intervalo seguinte.

**Esperado:** não aparecem zeros, candidatos “confirmados” ou timestamp
inventado; a tela informa que nenhum snapshot local está disponível; o retorno
dispara uma única requisição imediata; a UI anuncia a atualização uma vez e só
depois retoma o polling normal.

### ERROR-01 — erro HTTP, timeout e JSON inválido

**Pré-condição:** cache oficial A; simular, em sequência separada, `500`,
timeout de 8 s e JSON inválido.

**Passos:**

1. Deixar a tentativa automática falhar.
2. Observar o placar, o indicador de conectividade e a mensagem de erro.
3. Acionar `Tentar novamente` uma vez.

**Esperado:** A permanece intacto; a mensagem é “Não foi possível carregar os
resultados agora”, sem sugerir zero votos; existe `Tentar novamente` e acesso à
metodologia; retries usam backoff e não se sobrepõem; erro de conteúdo não é
tratado como offline; o identificador técnico fica em área secundária.

### ERROR-02 — falha ao persistir cache

**Pré-condição:** simular quota excedida ou falha de `localStorage` ao aceitar
um lote novo.

**Passos:**

1. Entregar snapshot B válido.
2. Forçar a falha de persistência.
3. Recarregar e repetir offline.

**Esperado:** B continua visível na sessão; a UI não afirma que B está salvo;
um erro recuperável é registrado sem dados pessoais; no reload/offline, A ou
“sem snapshot local” é mostrado com honestidade; a falha não corrompe o cache
anterior.

### ROUND-01 — troca para o segundo turno

**Pré-condição:** cache de 1º turno; fonte com snapshot de 2º turno separado;
ambos com o mesmo território e cargo.

**Passos:**

1. Selecionar `2º turno` e aplicar.
2. Observar label, placar, cobertura, candidatos e requisição.
3. Recarregar online e offline.
4. Voltar ao `1º turno`.

**Esperado:** a tela identifica claramente `2º turno`; dados do 1º turno não
aparecem no placar do 2º; cache, fingerprint, timestamp e polling são
particionados por eleição/turno/escopo; sem lote de 2º turno, mostrar
“aguardando publicação” em vez de reaproveitar números antigos; voltar ao 1º
turno restaura somente seu snapshot.

### A11Y-01 — teclado, foco e semântica

**Passos:**

1. Usar apenas teclado para navegar, selecionar filtros e disparar atualização.
2. Forçar sucesso, erro, offline e lote novo.
3. Verificar foco antes, durante e depois da atualização.

**Esperado:** ordem de foco é lógica; foco visível não fica escondido pelo
cabeçalho; controles têm nomes acessíveis; atualização não rouba foco; erros
usam região de alerta; mudanças de resultado usam região `status` sem anunciar
cada polling duplicado; `Esc` fecha qualquer aviso dispensável.

### A11Y-02 — VoiceOver/TalkBack e leitura do placar

**Passos:**

1. Navegar pelo placar com VoiceOver no desktop/macOS e TalkBack no mobile.
2. Ler candidato, valor, unidade, status, timestamp e cobertura.
3. Repetir durante lote novo, stale, offline e erro.

**Esperado:** cada métrica é lida como uma sequência compreensível, por
exemplo: “Presidente, Brasil, 1º turno, 12.345 votos, parcial, 42 de 100
seções, atualizado às 18:42”; estado não depende de ponto/colorido; mensagens
não interrompem leitura em andamento sem mudança relevante.

### A11Y-03 — contraste, zoom, movimento e toque

**Passos:**

1. Verificar desktop em 200% de zoom e mobile em 400% quando possível.
2. Ativar `prefers-reduced-motion`.
3. Testar retrato e paisagem, com alvos de toque e teclado virtual.

**Esperado:** texto, status, foco e controles mantêm contraste WCAG AA; nenhum
texto é cortado ou fica inacessível horizontalmente; o botão de atualizar e os
filtros têm alvo mínimo de 44 × 44 px; sem movimento essencial; atualização não
reposiciona a tela.

## Registro de evidência

Para cada execução registrar: caso, data/hora, viewport, navegador/OS, estado
online/offline, eleição/turno/escopo, snapshot inicial e recebido (`updatedAt`,
seções e fingerprint), resultado esperado/observado, requisições e console,
além de screenshot antes/durante/depois quando houver mudança visual. Testes
de acessibilidade devem registrar também tecnologia assistiva, zoom, foco e
anúncios audíveis.

## Limites desta revisão

A revisão foi feita sobre o app local e suas telas atuais em desktop e mobile.
Não foi possível provar, na implementação atual, polling, backoff, timeout,
particionamento de cache por turno, mensagens de stale/erro ou anúncio por
leitor de tela; esses itens ficam como casos obrigatórios de validação para a
implementação da sincronização automática. Nenhuma alteração de código faz
parte deste documento.
