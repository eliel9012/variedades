# Revisão de produto/UI — painel eleitoral mobile-first

## Escopo e limite da revisão

Este documento define uma direção de produto e UI para um painel eleitoral confiável, acessível e útil em contexto móvel. Não houve app, código, screenshots, dados ou sistema visual disponível para inspeção neste workspace; portanto, não é uma auditoria visual de uma implementação existente. As recomendações abaixo são critérios de projeto e aceitação para orientar o protótipo e a validação posterior.

O painel deve ajudar uma pessoa a responder, em poucos segundos:

1. O que já foi apurado?
2. Qual é a fonte, o horário e a cobertura desse número?
3. O que mudou desde a última atualização?
4. O que ainda não dá para afirmar?

## Arquitetura de informação

### Navegação principal

Use uma navegação inferior com quatro destinos persistentes, rotulados com texto e ícone:

- **Visão geral** — placar atual, participação, cobertura e alertas relevantes.
- **Cargos e disputas** — seleção de cargo, turno e território; comparação entre candidatos.
- **Mapa** — cobertura territorial e status da apuração, sem depender apenas de cor.
- **Metodologia** — fontes, definições, horários, limitações e histórico de atualizações.

Mantenha um seletor de contexto no topo: `Eleição / território / cargo / turno`. O contexto selecionado deve aparecer em texto legível, não apenas em menus ou breadcrumbs. Se houver mais de uma eleição disponível, o nome completo e o ano devem ser visíveis antes de qualquer número.

### Hierarquia da tela Visão geral

1. **Barra de status da apuração**
   - Estado explícito: `Ao vivo`, `Atualizado há 2 min`, `Atualização atrasada`, `Finalizado` ou `Dados indisponíveis`.
   - Horário da última atualização e botão `Atualizar`.
   - Cobertura: seções/urnas/municípios recebidos e total esperado, com a unidade correta.
2. **Resumo do turno e território**
   - Nome da eleição, turno e filtro territorial ativos.
   - Link de ação `Alterar filtros`, sem resetar filtros já escolhidos ao voltar.
3. **Destaques numéricos**
   - Participação, votos válidos, brancos/nulos e percentual de apuração.
   - Cada métrica deve ter definição acessível via `O que significa?`.
4. **Disputas prioritárias**
   - Lista ordenada por relevância definida pelo usuário (por exemplo, cargo selecionado), nunca somente por um critério editorial oculto.
   - Candidato, partido/federação, votos absolutos, percentual, diferença para o seguinte e situação de segundo turno quando aplicável.
5. **Mudanças recentes**
   - O que mudou desde a atualização anterior, com horário e magnitude da mudança.
6. **Rodapé de confiança**
   - Fonte, timestamp, cobertura, versão dos dados e acesso à metodologia.

### Tela de cargo/disputa

Priorize leitura comparativa e não um ranking visualmente sensacionalista:

- Cabeçalho com cargo, território, turno e status da apuração.
- Resumo: total de votos contabilizados, percentual de cobertura e regra aplicável ao cargo.
- Cada candidato em uma linha ou cartão compacto, com nome completo, nome de urna, partido/federação, votos e percentual.
- Barra de progresso pode apoiar a leitura, mas não substituir valores exatos.
- Inclua `Diferença para o próximo` e indique quando a diferença não é significativa por causa da cobertura incompleta.
- Ações secundárias: `Ver evolução`, `Comparar candidatos`, `Compartilhar resultado`.

### Tela de mapa

O mapa é uma camada de exploração, não a única forma de compreender o resultado:

- Ofereça uma alternativa em lista/tabela com o mesmo conteúdo.
- Exiba legenda textual, unidade territorial, timestamp e percentual de cobertura.
- Use padrões, rótulos ou símbolos além de cor para estados de apuração.
- Toque em uma região abre um painel inferior com nome, status, cobertura e link para o detalhe.
- Evite pintar regiões sem dados como se fossem empate, zero ou resultado consolidado.

### Filtros e busca

- Filtros aparecem em uma folha inferior com resumo das seleções e botões `Aplicar` e `Limpar`.
- Mostre o número de filtros ativos e permita remover cada filtro individualmente.
- Busca por candidato, partido, cargo e território deve informar quantos resultados existem.
- Preserve o estado dos filtros ao navegar entre visão geral, disputa e mapa.
- Não use filtros que alterem simultaneamente o significado da métrica sem atualizar o título e a fonte.

## Estados vazios, erro e offline

Todo estado deve responder claramente: o que aconteceu, se os dados podem ser confiados e qual é a próxima ação.

### Vazio inicial

**Mensagem:** “Escolha uma eleição e um território para começar.”

Mostrar um seletor primário `Selecionar eleição` e uma breve explicação do que aparecerá. Não exibir cards vazios, zeros ou gráficos em branco como se fossem dados reais.

### Sem resultados para filtros

**Mensagem:** “Nenhum resultado encontrado para estes filtros.”

Mostrar os filtros ativos e ações `Remover último filtro` e `Limpar filtros`. Não recomendar alterar filtros sem dizer por quê. Manter a busca digitada para permitir correção rápida.

### Aguardando apuração

**Mensagem:** “A apuração ainda não começou neste território.”

Exibir horário esperado somente se existir uma fonte oficial para isso. Diferenciar “ainda não começou” de “não recebemos dados”.

### Apuração parcial

**Mensagem:** “Resultado parcial — 42% das seções recebidas.”

Todo card de candidato e gráfico deve carregar o selo `Parcial`. Incluir a hora da última atualização, a unidade de cobertura e uma nota: “Este resultado pode mudar conforme novas seções forem recebidas.”

### Atualização em andamento

Usar skeleton apenas para conteúdo que realmente está sendo carregado. Para atualização de dados existentes, manter o último valor visível e mostrar uma faixa não bloqueante: “Atualizando dados…”. Evitar trocar números por spinners, pois isso impede comparação.

### Atualização atrasada

**Mensagem:** “Os dados podem estar desatualizados.”

Exibir último horário recebido, duração do atraso e `Tentar novamente`. Se o dado estiver fora da janela de confiabilidade definida pela fonte, reduzir sua ênfase e marcar claramente como desatualizado.

### Erro de rede ou servidor

**Mensagem:** “Não foi possível carregar os resultados agora.”

Explicar que isso não significa zero votos ou ausência de apuração. Ações: `Tentar novamente` e `Ver metodologia`. Registrar um identificador técnico em uma área secundária para suporte, sem expor detalhes confusos no caminho principal.

### Offline

Ao perder conectividade, mostrar uma faixa persistente: “Sem conexão — mostrando dados recebidos às 14:32.” Manter os dados em cache somente se houver timestamp e fonte associados a cada conjunto. Desabilitar ações que exigem rede e informar isso no próprio controle. Ao voltar a conexão, anunciar a atualização sem reposicionar a tela nem alterar filtros silenciosamente.

### Dados inconsistentes ou indisponíveis

Se totais não fecharem, cobertura estiver indefinida ou a fonte tiver sinalizado revisão, não inventar um valor compensatório. Mostrar `Dados em validação`, explicar o impacto e preservar o acesso aos números anteriores com seu timestamp, se permitido pela política de dados.

### Finalização

**Mensagem:** “Apuração finalizada às 18:42.”

Mostrar a fonte que declarou a finalização e manter o histórico de atualizações. Não remover o selo `Finalizado` em recarregamentos nem sugerir que um ranking visual é uma certificação jurídica.

## Critérios de confiança

Confiança deve ser observável na interface, não uma promessa de marca. Um resultado só pode ser apresentado como atual quando todos os critérios abaixo forem atendidos:

- **Proveniência:** cada conjunto de dados identifica fonte oficial ou agregador responsável, URL/documento de referência quando aplicável e momento de ingestão.
- **Atualidade:** timestamp visível no mesmo contexto do número; “agora” nunca substitui hora absoluta.
- **Cobertura:** percentual ou contagem com denominador e unidade explícitos (`1.245 de 3.000 seções`, não apenas `41%`).
- **Status:** `Parcial`, `Consolidado`, `Finalizado`, `Atrasado` e `Em validação` têm definições documentadas e aparência distinta.
- **Definições:** votos válidos, brancos, nulos, abstenções, apuração e participação têm explicações curtas e acessíveis.
- **Consistência:** totais, percentuais e ordenação seguem a mesma regra em cards, tabelas, mapa e compartilhamento.
- **Histórico:** alterações relevantes mostram antes/depois, horário e motivo quando a fonte fornecer uma correção.
- **Separação entre fato e interpretação:** não usar linguagem como “vitória”, “virada” ou “eleito” sem o status oficial e a regra aplicável.
- **Resiliência:** offline e erro preservam o contexto do último dado; nunca substituem ausência de dado por zero.
- **Compartilhamento seguro:** imagem/link compartilhado inclui eleição, território, turno, status, timestamp, cobertura e fonte; não permitir que um recorte sem contexto pareça definitivo.
- **Atualização previsível:** polling não deve causar salto de scroll, mudança inesperada de filtro ou anúncio repetitivo para leitores de tela.

### Gate de publicação

Antes de expor uma métrica no painel, validar:

1. A fonte e o timestamp estão presentes?
2. O denominador da cobertura está claro?
3. O usuário consegue distinguir parcial de final?
4. O número continua interpretável sem cor, gráfico ou contexto adicional?
5. O comportamento offline/erro evita que o usuário conclua “zero” ou “finalizado”?
6. A mesma métrica fecha com os totais e regras definidos na metodologia?

Se qualquer resposta for “não”, o componente deve cair para um estado de dados indisponíveis ou em validação.

## Direção visual específica

### Princípio

**“Boletim cívico verificável”:** uma interface sóbria, clara e auditável, com densidade suficiente para consulta rápida e espaço suficiente para leitura em celular. A sensação deve vir de precisão editorial e consistência, não de urgência ou gamificação.

### Paleta

- Fundo principal: `#F6F8FB` (cinza muito claro e neutro).
- Superfícies: `#FFFFFF`, com borda `#D9E0EA` em vez de sombra pesada.
- Texto principal: `#152033`; texto secundário: `#526176`.
- Ação primária: azul profundo `#155EEF`; foco visível: `#F79009` com contorno de 3px.
- Sucesso/consolidado: verde azulado `#087F5B`; atenção/parcial: âmbar `#B54708`; erro: vermelho escuro `#B42318`.
- Não codificar candidatos, partidos ou status apenas por cor. Quando a cor for usada em gráficos, combinar com rótulo, padrão ou ícone e manter contraste mínimo WCAG AA.

### Tipografia e layout

- Use uma sans-serif de alta legibilidade com números tabulares para placares.
- Corpo mínimo de 16px; texto auxiliar nunca abaixo de 14px.
- Títulos em sentence case, sem caixa alta integral.
- Grid de 4px, com espaçamento vertical predominante de 16 e 24px.
- Alvos de toque de pelo menos 44×44px, com separação suficiente para evitar toques acidentais.
- No mobile, um card por vez para métricas críticas; evitar carrosséis para dados essenciais.
- Evitar bordas arredondadas excessivas e gradientes. Use raio de 8px em superfícies e 6px em controles.
- Fixar o cabeçalho de contexto, não o placar inteiro: o usuário precisa ver o que está filtrado sem perder a capacidade de comparar conteúdo.

### Componentes-chave

- **StatusPill:** texto + ícone opcional + timestamp adjacente; nunca apenas um ponto colorido.
- **MetricCard:** valor, unidade, definição, timestamp e estado no mesmo agrupamento semântico.
- **CandidateRow:** posição opcional, nome, partido, votos, percentual e diferença; leitura linear em mobile.
- **CoverageBar:** valor absoluto e percentual, legenda textual e estado `parcial`/`finalizado`.
- **TrustFooter:** fonte, última atualização, cobertura, metodologia e histórico.
- **AlertBanner:** uma mensagem curta, tom objetivo, ação primária e possibilidade de dispensar somente quando a informação também estiver disponível em outro lugar.

### Movimento e feedback

Usar transições curtas apenas para indicar mudança de estado. Quando `prefers-reduced-motion` estiver ativo, remover animações e manter mudanças instantâneas. Para atualizações ao vivo, anunciar apenas mudanças importantes e fornecer controle para pausar a atualização automática.

## Acessibilidade e validação necessária

Critérios mínimos para o protótipo:

- Navegação completa por teclado e ordem de foco coerente.
- Foco sempre visível, sem ficar escondido por cabeçalho fixo ou folha inferior.
- Semântica de títulos, landmarks, tabelas e regiões de alerta correta.
- Leitura por VoiceOver/TalkBack de valor, unidade, estado, timestamp e cobertura como uma sequência compreensível.
- Contraste WCAG AA para texto e componentes; não depender de cor, posição ou animação.
- Tabela e gráfico com alternativa textual equivalente.
- Toque, zoom e orientação vertical testados em larguras móveis comuns.
- Teste de conexão lenta, perda de rede, retorno de rede, atualização interrompida e dados parciais.
- Teste com dados reais anonimizados para nomes longos, percentuais próximos, zero cobertura, empate e correção de resultado.

## Prioridade de implementação

**P0 — confiança e compreensão:** status/timestamp/cobertura em todos os números; estados de erro/offline; metodologia; ausência de zero falso; contraste e leitores de tela.

**P1 — exploração:** filtros persistentes; comparação de candidatos; histórico de atualização; alternativa textual ao mapa; compartilhamento contextualizado.

**P2 — refinamento:** alertas personalizáveis, visualizações avançadas, exportação e melhorias de performance em mapas.

## Limitações e próximos testes

Sem uma implementação ou captura disponível, não foi possível avaliar navegação real, comportamento de foco, tempos de carregamento, legibilidade em dispositivos específicos, precisão dos dados, integração com fontes oficiais ou comportamento efetivo de cache. Antes de considerar o painel pronto, capturar e revisar pelo menos: carregamento inicial, apuração parcial, atualização ao vivo, filtro sem resultados, erro de rede, offline com cache, retorno de conexão e resultado finalizado.
