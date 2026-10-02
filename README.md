# Apura Brasil

Painel eleitoral offline-first para as Eleições Gerais 2026. Interface em React/Vite. Dados de candidaturas e fotos são snapshots públicos do TSE; resultados só aparecem quando o TSE publica lote oficial.

## Rodar

```bash
npm install
npm run sync:tse
npm run dev
```

`npm run sync:tse` lê `work/tse/consulta_cand_2026.zip` e arquivos de foto em `work/tse/photos/` (ou o fallback `work/tse/foto_cand2026_BR_div.zip`). O comando não aplica nenhum filtro de cargo: gera todas as linhas do CSV oficial como estão (titulares, suplentes, vice-* e todos os códigos de cargo), mais imagens locais em `public/data/photos/`.

## UI / shadcn

Projeto usa React/Vite + TypeScript. Tailwind v4 entra pelo plugin `@tailwindcss/vite`; `components.json` mantém configuração shadcn. Componentes ficam em `src/components/ui/`, alias `@/components/ui` aponta para esse diretório, estilos globais ficam em `src/styles.css`.

Para adicionar componente shadcn: `npx shadcn@latest add <componente>`. Tailwind e TypeScript já estão instalados/configurados; não duplicar `components/ui` em outra raiz.

## Mapa por UF

O mapa vetorial fica no próprio bundle em `src/data/brazil-states.ts` (27 UFs, incluindo DF), sem dependência ou chamada externa em runtime. A interface não desenha a bandeira: usa apenas a paleta abstrata verde, azul e amarelo. Cada UF tem seleção por clique/teclado, tooltip acessível e ligação direta aos filtros de cargo e candidatos.

## Fontes

- [Portal de Dados Abertos do TSE, Candidatos 2026](https://dadosabertos.tse.jus.br/pt_BR/dataset/candidatos-2026)
- [Resultados TSE](https://resultados.tse.jus.br/)
- [Calendário eleitoral 2026](https://www.tse.jus.br/comunicacao/noticias/2026/Marco/eleicoes-2026-confira-as-principais-datas-do-calendario-eleitoral)

## Apuração automática

O app consulta o `ele-c.jws` oficial do TSE (com fallback `.json`), deriva o pleito/ciclo e lê EA20 (resultado unificado) + EA14/EA15 (acompanhamento Brasil/UF). Faz uma consulta a cada 15s, usa backoff até 120s em erro, aborta requests antigos ao trocar filtro e grava último lote oficial em `localStorage`. Sem endpoint oficial disponível, mantém `public/data/results/latest.json` como fallback; não fabrica placar.

Regras de escopo: Presidente aceita Brasil e 2º turno; Governador aceita UF e 2º turno; Senador, Deputado Federal, Deputado Estadual e Deputado Distrital ficam no 1º turno. Não existe “Governador do Brasil”; Distrital fica restrito ao DF.

O caminho padrão é `https://resultados.tse.jus.br/oficial/comum/config/ele-c.jws`. Se o TSE publicar bootstrap em caminho diferente, definir `VITE_TSE_RESULTS_CONFIG_URL` antes do build. O TSE recomenda derivar URLs pelo `ele-c.jws` e respeitar limite de 100 requisições/s por IP.

## Cenários (IA)

Aba que calcula probabilidades de liderança/vitória em 1º turno/2º turno a partir da pesquisa mais recente de cada
recorte (Presidente nacional, Presidente por estado, Governador por estado), via simulação de Monte Carlo
determinística em `server/scenario.mjs` (ver comentários do arquivo para a metodologia completa). Nenhum número de
probabilidade vem de um modelo de linguagem: o LLM só narra em texto os números já calculados.

Essa feature tem um processo Node companheiro, separado do `npm run dev`:

1. `GET /api/scenario` funciona sem nenhuma IA instalada; é só matemática simples sobre os JSONs de
   `public/data/polls-*.json`.
2. Para a caixa de perguntas (`POST /api/ask`), `server/ollama.mjs` fala com qualquer servidor compatível com a API
   da OpenAI (`/v1/chat/completions`): tanto [Ollama](https://ollama.com) quanto llama.cpp/llama-swap/llama-server
   funcionam, sem mudar código, só variável de ambiente.
3. Rode o servidor companheiro junto com o `npm run dev`, apontando pro seu servidor de LLM:

   ```bash
   LLM_URL=http://10.99.0.2:8080 LLM_MODEL=gpt-oss-20b LLM_API_KEY="sua-chave" npm run server
   ```

   Em outro terminal, `npm run dev` segue normalmente; o Vite já tem um proxy de `/api` para
   `http://127.0.0.1:8790` (ver `vite.config.ts`).

Variáveis de ambiente do `npm run server`:

- `PORT`: porta do servidor (padrão `8790`).
- `LLM_URL` (aceita `OLLAMA_URL` como sinônimo): URL base do servidor de LLM compatível com a API da OpenAI
  (padrão `http://127.0.0.1:11434`, que é o Ollama local; pra llama-swap/llama-server use a URL dele, ex.
  `http://10.99.0.2:8080`).
- `LLM_MODEL` (aceita `OLLAMA_MODEL` como sinônimo): nome do modelo disponível nesse servidor (obrigatório só para
  `/api/ask`; `/api/scenario` não depende disso).
- `LLM_API_KEY` (aceita `LLAMA_API_KEY` como sinônimo): chave de API, se o servidor exigir (llama-swap normalmente
  exige; Ollama local normalmente não).
- `AI_AUTH_USER` / `AI_AUTH_PASS`: credenciais de HTTP Basic Auth exigidas em toda rota `/api/*` (inclusive
  `/api/health`), porque esse processo pode rodar no servidor público (varia.meulab.fun), não só em localhost.
  `AI_AUTH_USER` tem padrão `admin`. Se `AI_AUTH_PASS` não for definida, o servidor gera uma senha aleatória a cada
  reinicialização e imprime uma vez no console ao subir (ela muda a cada restart enquanto a variável não for fixada
  explicitamente). O navegador pede usuário/senha nativamente na primeira chamada a `/api/*`, sem precisar de tela de
  login própria no front-end.

Os números de probabilidade em `/api/scenario` continuam válidos mesmo sem o servidor de LLM rodando; só a caixa de
perguntas fica indisponível (e a interface avisa isso claramente, sem fingir uma resposta).

## Analytics (Umami)

Analytics opcional, desligado por padrão. Usa [Umami](https://umami.is) (MIT, open source, sem cookie, self-hosted),
não Google Analytics.

1. No **servidor real** (não neste repo de dev), suba o Umami com o compose em `deploy/umami/`:

   ```bash
   cd deploy/umami
   cp .env.example .env   # preencha UMAMI_DB_PASSWORD e UMAMI_APP_SECRET (openssl rand -hex 32)
   docker compose up -d
   ```

   Isso sobe o Umami em `127.0.0.1:3010` (só local). Aponte um subdomínio (ex.: `analytics.meulab.fun`) pra essa porta
   via Cloudflare Zero Trust/Tunnel, do mesmo jeito que `varia.meulab.fun`/`eleicoes.meulab.fun` já apontam pro app.

2. Abra o Umami nesse subdomínio, crie o usuário admin, e cadastre um site apontando pro domínio do Apura Brasil
   (ex.: `eleicoes.meulab.fun`). Copie o **Website ID** gerado.

3. No build do app, defina (`.env.production` ou variável de ambiente do processo de build):

   ```bash
   VITE_UMAMI_SCRIPT_URL=https://analytics.meulab.fun/script.js
   VITE_UMAMI_WEBSITE_ID=<cole o Website ID aqui>
   ```

   Sem essas duas variáveis, `src/analytics.ts` não injeta nenhum script, o site funciona normal, só sem métricas.

## Anúncios

Quatro slots reservados e fixos, `src/components/ui/ad-slot.tsx`: `header`, `footer`, `sidebar` (coluna lateral,
só aparece em telas largas, ≥1100px) e `in-content` (bloco dentro do corpo do conteúdo, só aparece em telas mais
estreitas, <1100px). Nunca os dois últimos ao mesmo tempo, pra não dobrar carga de anúncio em quem já vê a coluna
lateral. Todos ficam com altura zero enquanto vazios (`ad-slot.css`, `:empty`), então não existe caixa vazia
atrapalhando leitura.

Cada slot só mostra uma unidade de anúncio quando **três** coisas são verdade ao mesmo tempo:

1. `VITE_AD_SCRIPT_URL` está preenchido no build (o script global da rede, carregado uma vez no `<head>`, ver
   `src/ads.ts`) e esse script termina de carregar;
2. a pessoa aceitou o cookie de anúncio no banner (`src/cookie-consent.ts`);
3. aquela posição específica tem um ID de unidade preenchido: `VITE_AD_SLOT_HEADER`, `VITE_AD_SLOT_FOOTER`,
   `VITE_AD_SLOT_SIDEBAR` ou `VITE_AD_SLOT_INCONTENT` (ver `.env.example`).

Sem uma dessas três, aquele slot nunca renderiza nada, nem um placeholder, nem uma caixa "anúncio aqui".

Nunca use "Auto ads" das redes (a rede escolhe a posição sozinha e pode cair em cima de dado eleitoral); os quatro
slots fixos aqui bastam e mantêm o anúncio longe dos números.

### Contrato técnico (pra quando a rede real entrar)

`src/ads.ts` carrega **um** script global por rede (padrão comum a AdSense, Media.net, Ezoic etc). Cada `AdSlot`
depois renderiza seu próprio `<ins data-ad-slot-id="...">` (nome genérico de espaço reservado) assim que
script+consentimento+ID da posição estiverem prontos, e dispara um "escaneia e preenche" genérico
(`requestAdFill()`) uma vez por posição. Isso imita o padrão real dessas redes (AdSense: array global
`window.adsbygoogle` + `.push({})` por `<ins>`; Ezoic: `ezstandalone.showAds(id)` por placeholder), só que com nomes
neutros. Quando a rede for escolhida de verdade, o ajuste é pequeno e fica todo marcado com comentário em
`src/ads.ts` e `src/components/ui/ad-slot.tsx`: trocar o nome do array/função global dentro de `requestAdFill()`, e
trocar a tag/atributo do `<ins>` pelo formato exato que a rede pedir (ex. `class="adsbygoogle"` +
`data-ad-client`/`data-ad-slot` no caso de uma rede da família AdSense).

## Rede de anúncios

Hoje o site não tem conta em nenhuma rede (AdSense foi rejeitado/não seguido adiante). Comparação rápida das
alternativas mais sérias, pensando num site de política/eleições brasileiro, com tráfego alto esperado, conteúdo em
português, e a exigência de não deixar anúncio atrapalhar visualmente os dados (sidebar + bloco no texto, nunca
anúncio flutuante/intersticial por cima de número):

| Rede | Dificuldade de aprovação p/ conteúdo político | Tráfego mínimo | Integração | Serve pra este site? |
|---|---|---|---|---|
| **Media.net** | Moderada, mas **exige site majoritariamente em inglês** pra aprovar | ~10 mil visitas/mês | Script global + `<ins>`/`<div>` por posição | **Não.** O site é em português; essa exigência de idioma desqualifica de cara, não é sobre o conteúdo ser político. |
| **Ezoic** | Moderada; aceita qualquer idioma suportado pelo AdSense (inclui português; tem publisher brasileiro de caso real documentado) | Historicamente ~10 mil visitas/mês; programa "Access Now" cobre sites menores; alguns relatos de 2026 citam patamar bem mais alto pro acesso completo (vale confirmar no cadastro) | Script global + `<div id="ezoic-pub-ad-placeholder-N">` por posição, chamando `ezstandalone.showAds(N)` | **Sim, é a recomendação.** Aceita português, aceita o formato "script global + unidade por posição" que já está implementado aqui, usa IA pra testar layout sem precisar de anúncio intersticial agressivo, e tem um histórico mais "editorial" (parceiro certificado do Google) que combina com um site de dado público. |
| Adsterra / PropellerAds | Aprovação fácil, aceitam praticamente qualquer site incluindo político | Sem mínimo relevante | Script + `<ins>`/`<div>` | Não recomendado aqui. Formatos comuns dessas redes (pop-under, interstitial, redirect) são exatamente o tipo de anúncio que atrapalha a leitura de dado eleitoral e prejudica a credibilidade de um site de apuração; servem melhor a sites de entretenimento/tráfego descartável. |
| Google Ad Manager direto (fora do AdSense) | Alta (precisa de relação comercial/mínimo de inventário com a Google ou um revendedor) | Tipicamente dezenas de milhões de impressões/mês | Tag própria do GAM, mesmo padrão de "script + slot por posição" | Vale revisitar **depois** que o tráfego do Ezoic comprovar volume alto de verdade; não é um ponto de partida viável sem relação comercial prévia. |

**Recomendação: Ezoic.** Critério de desempate contra Media.net é o idioma (desqualificador, não ajustável). Contra
Adsterra/PropellerAds é o tipo de formato de anúncio (os dois priorizam CPM alto com formatos intrusivos, incompatível
com "não pode atrapalhar visualmente os dados"). Ezoic é o único das opções realistas hoje que: aceita conteúdo em
português, tem casos de uso reais com publishers brasileiros, roda no mesmo desenho técnico de "script global +
unidade por posição" que esse repositório já implementa (`src/ads.ts`/`ad-slot.tsx`), e tem reputação de
"display ads" tradicionais em vez de formato agressivo.

### Próximos passos (precisa de uma pessoa, não dá pra automatizar)

1. Cadastrar o domínio em [ezoic.com](https://www.ezoic.com) (precisa de CPF/CNPJ e dado de pagamento de quem for
   receber, por isso não dá pra fazer por aqui).
2. Depois de aprovado, o painel do Ezoic dá: a URL do script global (vai em `VITE_AD_SCRIPT_URL`) e um ID de
   unidade/placeholder por posição que você criar no painel (header, rodapé, lateral, no texto). Cada um desses IDs
   vai numa env var: `VITE_AD_SLOT_HEADER`, `VITE_AD_SLOT_FOOTER`, `VITE_AD_SLOT_SIDEBAR`, `VITE_AD_SLOT_INCONTENT`.
3. Se o formato exato de unidade do Ezoic não for um `<ins>` genérico (ver "Contrato técnico" acima), ajustar
   `src/components/ui/ad-slot.tsx` e a função `requestAdFill()` em `src/ads.ts` pro nome/formato exato que o painel
   do Ezoic pedir (o comentário em cada arquivo mostra exatamente o que trocar).
4. Rodar o build com as env vars preenchidas (`.env.production` ou variável do processo), confirmar visualmente que
   nenhum anúncio cai em cima de mapa/tabela/número antes de publicar.

## Cache (Cloudflare)

Plano gratuito já cobre o essencial. `deploy/cloudflare/setup-cache.sh` liga via API: Brotli, Always Online (serve a
última versão em cache se o servidor cair) e 3 Page Rules (`/api/*` sem cache, `/assets/*` e `/data/*` com cache).
Leia o cabeçalho do script antes de rodar: ele lê `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`/`SITE_DOMAIN` do
ambiente, nunca cole token dentro do arquivo nem commite um `.env` com ele.

## Limites

Resultados podem chegar em lotes; “15s” é frequência de consulta, não promessa de mudança a cada segundo. CORS da CDN pode variar; em produção, um proxy/server-side é mais robusto que fetch direto no navegador.
