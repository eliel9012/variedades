# Apura Brasil

Painel eleitoral offline-first para as Eleições Gerais 2026. Interface em React/Vite. Dados de candidaturas e fotos são snapshots públicos do TSE; resultados só aparecem quando o TSE publica lote oficial.

## Rodar

```bash
npm install
npm run sync:tse
npm run dev
```

`npm run sync:tse` lê `work/tse/consulta_cand_2026.zip` e arquivos de foto em `work/tse/photos/` (ou o fallback `work/tse/foto_cand2026_BR_div.zip`). O comando não aplica nenhum filtro de cargo — gera todas as linhas do CSV oficial como estão (titulares, suplentes, vice-* e todos os códigos de cargo) — mais imagens locais em `public/data/photos/`.

## UI / shadcn

Projeto usa React/Vite + TypeScript. Tailwind v4 entra pelo plugin `@tailwindcss/vite`; `components.json` mantém configuração shadcn. Componentes ficam em `src/components/ui/`, alias `@/components/ui` aponta para esse diretório, estilos globais ficam em `src/styles.css`.

Para adicionar componente shadcn: `npx shadcn@latest add <componente>`. Tailwind e TypeScript já estão instalados/configurados; não duplicar `components/ui` em outra raiz.

## Mapa por UF

O mapa vetorial fica no próprio bundle em `src/data/brazil-states.ts` (27 UFs, incluindo DF), sem dependência ou chamada externa em runtime. A interface não desenha a bandeira: usa apenas a paleta abstrata verde, azul e amarelo. Cada UF tem seleção por clique/teclado, tooltip acessível e ligação direta aos filtros de cargo e candidatos.

## Fontes

- [Portal de Dados Abertos do TSE — Candidatos 2026](https://dadosabertos.tse.jus.br/pt_BR/dataset/candidatos-2026)
- [Resultados TSE](https://resultados.tse.jus.br/)
- [Calendário eleitoral 2026](https://www.tse.jus.br/comunicacao/noticias/2026/Marco/eleicoes-2026-confira-as-principais-datas-do-calendario-eleitoral)

## Apuração automática

O app consulta o `ele-c.jws` oficial do TSE (com fallback `.json`), deriva o pleito/ciclo e lê EA20 (resultado unificado) + EA14/EA15 (acompanhamento Brasil/UF). Faz uma consulta a cada 15s, usa backoff até 120s em erro, aborta requests antigos ao trocar filtro e grava último lote oficial em `localStorage`. Sem endpoint oficial disponível, mantém `public/data/results/latest.json` como fallback; não fabrica placar.

Regras de escopo: Presidente aceita Brasil e 2º turno; Governador aceita UF e 2º turno; Senador, Deputado Federal, Deputado Estadual e Deputado Distrital ficam no 1º turno. Não existe “Governador do Brasil”; Distrital fica restrito ao DF.

O caminho padrão é `https://resultados.tse.jus.br/oficial/comum/config/ele-c.jws`. Se o TSE publicar bootstrap em caminho diferente, definir `VITE_TSE_RESULTS_CONFIG_URL` antes do build. O TSE recomenda derivar URLs pelo `ele-c.jws` e respeitar limite de 100 requisições/s por IP.

## Limites

Resultados podem chegar em lotes; “15s” é frequência de consulta, não promessa de mudança a cada segundo. CORS da CDN pode variar; em produção, um proxy/server-side é mais robusto que fetch direto no navegador.
