# Apura Brasil

Painel eleitoral offline-first para as Eleições Gerais 2026. Interface em React/Vite. Dados de candidaturas e fotos são snapshots públicos do TSE; resultados só aparecem quando o TSE publica lote oficial.

## Rodar

```bash
npm install
npm run sync:tse
npm run dev
```

`npm run sync:tse` lê `work/tse/consulta_cand_2026.zip` e arquivos de foto em `work/tse/photos/` (ou o fallback `work/tse/foto_cand2026_BR_div.zip`). O comando gera todas as candidaturas do CSV oficial — incluindo deputado estadual (código 0007) e distrital (0008) — mais imagens locais em `public/data/photos/`.

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
