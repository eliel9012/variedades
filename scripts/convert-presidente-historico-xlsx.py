#!/usr/bin/env python3
"""Converte a planilha de evolução histórica por estado
(data/sources/presidente-historico-2018-2022-2026.xlsx) em
public/data/polls-presidente-historico.json.

Diferente de polls-presidente-estados.json (pesquisas correntes), esta
planilha junta 3 "rodadas" bem diferentes por estado:
  - 2018 e 2022: resultado OFICIAL de 1º turno (TSE), % sobre votos válidos.
  - 2026: pesquisa de intenção de voto (Quaest/AtlasIntel conforme o estado,
    ver aba "Sources"), não é resultado.
Isso tem que ficar visualmente e textualmente claro na UI: nunca misturar
"resultado" com "pesquisa" sem dizer qual é qual (ver `isPoll` por ponto).

Como scripts/convert-presidente-estados-xlsx.py, isto NAO roda no build
automatico: a planilha é compilação manual (ver aba "Sources").

Para atualizar: troque o arquivo em data/sources/ e rode:
    python3 scripts/convert-presidente-historico-xlsx.py data/sources/<arquivo>.xlsx

Requer `openpyxl` (pip install openpyxl).
"""
import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "data/sources/presidente-historico-2018-2022-2026.xlsx"
OUTPUT = ROOT / "public/data/polls-presidente-historico.json"

# Mesmo nome/UF usado em src/data/brazil-states.ts (fonte única de verdade
# pro resto do site), repetido aqui porque o script Python não importa TS.
NAME_TO_UF = {
    "Roraima": "RR", "Amapá": "AP", "Amazonas": "AM", "Pará": "PA", "Acre": "AC",
    "Rondônia": "RO", "Tocantins": "TO", "Maranhão": "MA", "Ceará": "CE",
    "Rio Grande do Norte": "RN", "Paraíba": "PB", "Pernambuco": "PE",
    "Alagoas": "AL", "Sergipe": "SE", "Piauí": "PI", "Bahia": "BA",
    "Mato Grosso": "MT", "Goiás": "GO", "Distrito Federal": "DF",
    "Mato Grosso do Sul": "MS", "Minas Gerais": "MG", "Espírito Santo": "ES",
    "Rio de Janeiro": "RJ", "São Paulo": "SP", "Paraná": "PR",
    "Santa Catarina": "SC", "Rio Grande do Sul": "RS",
}


def pct(value):
    if value is None:
        return None
    return round(value * 100, 1)


def main():
    source_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    wb = openpyxl.load_workbook(source_path, data_only=True)

    ws = wb["1st Round by State"]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    col = {name: idx for idx, name in enumerate(header)}

    sources_ws = wb["Sources"]
    source_rows = list(sources_ws.iter_rows(values_only=True))[1:]
    sources = [
        {"publisher": r[1], "usedFor": r[2], "url": r[3]}
        for r in source_rows
        if r[1]
    ]
    primary_reference = next(
        (r[0] for r in source_rows if r[0] and isinstance(r[0], str) and r[0].startswith("Primary reference")),
        None,
    )

    states = []
    for r in rows[1:]:
        state_name = r[col["State"]]
        uf = NAME_TO_UF.get(state_name)
        if not uf:
            continue

        pt_line = [
            {"year": 2018, "candidateName": "Haddad", "party": "PT", "percentage": pct(r[col["Haddad 2018"]]), "isPoll": False},
            {"year": 2022, "candidateName": "Lula", "party": "PT", "percentage": pct(r[col["Lula 2022"]]), "isPoll": False},
            {"year": 2026, "candidateName": "Lula", "party": "PT", "percentage": pct(r[col["Intencao de votos Lula (PT) 2026"]]), "isPoll": True},
        ]
        bolsonaro_line = [
            {"year": 2018, "candidateName": "Bolsonaro", "party": "PL", "percentage": pct(r[col["Bolsonaro 2018"]]), "isPoll": False},
            {"year": 2022, "candidateName": "Bolsonaro", "party": "PL", "percentage": pct(r[col["Bolsonaro 2022"]]), "isPoll": False},
            {"year": 2026, "candidateName": "Flávio Bolsonaro", "party": "PL", "percentage": pct(r[col["Flávio Bolsonaro (PL) 2026"]]), "isPoll": True},
        ]
        outros_line = [
            {"year": 2018, "candidateName": "Outros", "party": None, "percentage": pct(r[col["Outros 2018"]]), "isPoll": False},
            {"year": 2022, "candidateName": "Outros", "party": None, "percentage": pct(r[col["Outros 2022"]]), "isPoll": False},
            {"year": 2026, "candidateName": "Outros", "party": None, "percentage": pct(r[col["Outros 2026"]]), "isPoll": True},
        ]

        states.append(
            {
                "uf": uf,
                "state": state_name,
                "pt": pt_line,
                "bolsonaro": bolsonaro_line,
                "outros": outros_line,
                "undecided2026": pct(r[col["Undecided 2026"]]),
                "blank2026": pct(r[col["Blank / null / won't vote 2026"]]),
            }
        )

    states.sort(key=lambda s: s["state"])

    output = {
        "generatedAt": "2026-10-02T00:00:00Z",
        "compiledManually": True,
        "note": (
            "2018 e 2022 são resultado oficial de 1º turno (TSE), % sobre votos "
            "válidos. 2026 é pesquisa de intenção de voto (não é resultado), "
            "principalmente Quaest/TV Globo por estado, com Piauí vindo de "
            "AtlasIntel (ver `sources`). Outros 2026 agrega os demais nomes "
            "testados na pesquisa de cada estado, que mudam de estado pra "
            "estado — não é o mesmo conjunto de candidatos em todo lugar."
        ),
        "primaryReference": primary_reference,
        "sources": sources,
        "states": states,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Gravado {OUTPUT} com {len(states)} UFs.")


if __name__ == "__main__":
    main()
