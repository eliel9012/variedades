#!/usr/bin/env python3
"""Converte a planilha manual de pesquisas de Senador (data/sources/senado-*.xlsx)
em public/data/polls-senado.json.

Diferente de scripts/sync-tse.mjs e scripts/sync-polls.mjs, este script NÃO roda
automaticamente no build: não existe hoje nenhuma fonte pública/gratuita com
endpoint estável para pesquisas de Senador por estado (GCMais e Gazeta do Povo
publicam como texto/matéria, não como API). Os dados aqui vêm de uma planilha
compilada manualmente a partir de matérias jornalísticas reais e citadas
(aba "Sources" da planilha), com data de compilação registrada.

Para atualizar: substitua o arquivo em data/sources/ por uma planilha mais
recente no mesmo formato (abas README/Coverage/Senador/Sources) e rode:
    python3 scripts/convert-senado-xlsx.py data/sources/<arquivo>.xlsx

Requer `openpyxl` (pip install openpyxl).
"""
import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "data/sources/senado-2026-10-01.xlsx"
OUTPUT = ROOT / "public/data/polls-senado.json"


def clean(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def main():
    source_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    wb = openpyxl.load_workbook(source_path, data_only=True)

    readme_lines = [row[0] for row in wb["README"].iter_rows(values_only=True) if row[0]]

    sources_ws = wb["Sources"]
    source_rows = list(sources_ws.iter_rows(values_only=True))[1:]
    sources = [
        {"publisher": clean(r[0]), "usedFor": clean(r[1]), "url": clean(r[2])}
        for r in source_rows
        if r[0]
    ]

    senador_ws = wb["Senador"]
    rows = list(senador_ws.iter_rows(values_only=True))
    header = rows[0]
    col = {name: idx for idx, name in enumerate(header)}

    by_uf = {}
    for r in rows[1:]:
        if not r[col["UF"]]:
            continue
        uf = clean(r[col["UF"]])
        entry = by_uf.setdefault(
            uf,
            {
                "uf": uf,
                "state": clean(r[col["State"]]),
                "pollster": clean(r[col["Pollster"]]),
                "fieldwork": clean(r[col["Fieldwork"]]),
                "sample": clean(r[col["Sample"]]),
                "marginOfError": clean(r[col["Margin of error"]]),
                "tseRegistration": clean(r[col["TSE registration"]]),
                "basis": clean(r[col["Basis"]]),
                "completeness": clean(r[col["Completeness"]]),
                "source": clean(r[col["Source"]]),
                "sourceUrl": clean(r[col["URL"]]),
                "results": [],
            },
        )
        entry["results"].append(
            {
                "candidateName": clean(r[col["Candidate / option"]]),
                "party": clean(r[col["Party"]]),
                "percentage": round(clean(r[col["Vote intention"]]) * 100, 1)
                if isinstance(clean(r[col["Vote intention"]]), (int, float))
                else None,
                "notes": clean(r[col["Notes"]]),
            }
        )

    states = list(by_uf.values())
    for state in states:
        state["results"].sort(key=lambda row: row["percentage"] or 0, reverse=True)
        total = sum(row["percentage"] or 0 for row in state["results"])
        state["percentageSum"] = round(total, 1)

    states.sort(key=lambda s: s["state"] or s["uf"])

    output = {
        "generatedAt": "2026-10-01T00:00:00Z",
        "compiledManually": True,
        "note": (
            "Compilação manual a partir de matérias jornalísticas reais (ver "
            "`sources`), não de um feed automático. Não há 2º turno para "
            "Senado no Brasil: cada eleitor vota em até 2 candidatos e os mais "
            "votados são eleitos em turno único."
        ),
        "readme": readme_lines,
        "sources": sources,
        "states": states,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Gravado {OUTPUT} com {len(states)} UFs.")


if __name__ == "__main__":
    main()
