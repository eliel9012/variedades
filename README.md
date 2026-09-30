# Apura Brasil

Painel eleitoral offline-first para as Eleições Gerais 2026. Interface em React/Vite. Dados de candidaturas e fotos são snapshots públicos do TSE; resultados só aparecem quando o TSE publica lote oficial.

## Rodar

```bash
npm install
npm run sync:tse
npm run dev
```

`npm run sync:tse` lê `work/tse/consulta_cand_2026.zip` e arquivos de foto em `work/tse/photos/` (ou o fallback `work/tse/foto_cand2026_BR_div.zip`). O comando gera `public/data/candidates.json`, `public/data/manifest.json` e imagens locais. Para atualizar, baixe novos arquivos oficiais e rode o comando novamente.

## Fontes

- [Portal de Dados Abertos do TSE — Candidatos 2026](https://dadosabertos.tse.jus.br/pt_BR/dataset/candidatos-2026)
- [Resultados TSE](https://resultados.tse.jus.br/)
- [Calendário eleitoral 2026](https://www.tse.jus.br/comunicacao/noticias/2026/Marco/eleicoes-2026-confira-as-principais-datas-do-calendario-eleitoral)

## Limite atual

O adapter de resultados está preparado para receber snapshots oficiais, mas não fabrica placar antes da publicação do TSE. Próximo passo: ligar `public/data/results/latest.json` ao formato de resultados liberado durante a apuração e registrar cada lote localmente.
