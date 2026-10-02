#!/usr/bin/env python3
"""Converte a planilha manual de pesquisas de Presidente por estado
(data/sources/presidente-estados-*.xlsx) em public/data/polls-presidente-estados.json.

Como scripts/convert-senado-xlsx.py, isto NAO roda no build automatico: nao existe
fonte publica com endpoint estavel para pesquisa presidencial por estado (cada
pesquisa sai como materia de jornal, nao API). A planilha fonte reune 9 materias
reais e citadas (aba "Sources"), compiladas manualmente.

Modelo de dados: cada estado tem uma ou duas "waves" (rodadas de divulgacao):
  1) a aba "1st Round by State": lista de candidatos da rodada mais recente
     disponivel por estado (a maioria e "Aug round", 5 estados ja vem com uma
     rodada mais nova de final de setembro: CE, PA, PE, PI, SP).
  2) a aba "Late-Sep Lula vs Flavio": atualizacao de finalzinho de setembro,
     mas a fonte (Band) so divulgou os 2 primeiros colocados, nao a lista
     completa. So vira uma 2a wave quando e de fato uma rodada nova (ou seja,
     quando o estado NAO esta entre os 5 que ja tem "Late-Sep round" na aba
     principal, e quando a Band teve numero para aquele estado -- SE e TO
     ficam de fora porque a propria fonte diz "no newer poll found").
  Goias e caso especial: a nota da planilha diz que Caiado tambem foi medido
  nessa rodada (23%), so o 3o nome entra na wave mesmo ela sendo "Leaders only".

Para atualizar: troque o arquivo em data/sources/ por uma planilha mais
recente no mesmo formato e rode:
    python3 scripts/convert-presidente-estados-xlsx.py data/sources/<arquivo>.xlsx

Requer `openpyxl` (pip install openpyxl).
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "data/sources/presidente-estados-2026-10-02.xlsx"
OUTPUT = ROOT / "public/data/polls-presidente-estados.json"

CANDIDATE_COLUMNS = [
    "Lula (PT)",
    "Flávio Bolsonaro (PL)",
    "Ronaldo Caiado (PSD)",
    "Romeu Zema (Novo)",
    "Renan Santos (Missão)",
    "Augusto Cury (Avante)",
    "Samara Martins (UP)",
    "Rui Costa Pimenta (PCO)",
    "Clariana Barão (DC)",
    "Wilson Grassi (Democrata)",
    "Edmilson Costa (PCB)",
    "Hertz Dias (PSTU)",
    "Leonardo Avalanche (PRTB)",
]

NAME_PARTY_RE = re.compile(r"^(.*)\s+\(([^)]+)\)$")

# Fonte: nota "Goiás: Caiado 23% in the same round" na aba Sources (mesma
# materia da Band usada para as outras linhas de "Late-Sep Lula vs Flávio").
GOIAS_CAIADO_LATE_SEP_PCT = 23.0


def clean(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def name_party(column_header):
    match = NAME_PARTY_RE.match(column_header)
    if not match:
        return column_header, None
    return match.group(1).strip(), match.group(2).strip()


def pct(value):
    if value is None:
        return None
    return round(value * 100, 1)


def main():
    source_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    wb = openpyxl.load_workbook(source_path, data_only=True)

    main_ws = wb["1st Round by State"]
    main_rows = list(main_ws.iter_rows(values_only=True))
    header = main_rows[0]
    col = {name: idx for idx, name in enumerate(header)}

    late_ws = wb["Late-Sep Lula vs Flávio"]
    late_rows = list(late_ws.iter_rows(values_only=True))
    late_header = late_rows[0]
    late_col = {name: idx for idx, name in enumerate(late_header)}
    late_by_uf = {
        r[late_col["UF"]]: r
        for r in late_rows[1:]
        if r[late_col["UF"]]
    }

    sources_ws = wb["Sources"]
    source_rows = list(sources_ws.iter_rows(values_only=True))[1:]
    sources = [
        {"publisher": clean(r[1]), "usedFor": clean(r[2]), "url": clean(r[3])}
        for r in source_rows
        if r[1]
    ]

    readme_lines = []
    for r in main_rows[1:]:
        first_cell = r[0]
        if isinstance(first_cell, str) and first_cell.startswith("•"):
            readme_lines.append(first_cell.lstrip("• ").strip())

    states = []
    for r in main_rows[1:]:
        uf = clean(r[col["UF"]])
        if not uf or len(uf) != 2 or not uf.isalpha():
            continue

        results = []
        for column_header in CANDIDATE_COLUMNS:
            value = clean(r[col[column_header]])
            if value is None:
                continue
            candidate_name, party = name_party(column_header)
            results.append(
                {
                    "candidateName": candidate_name,
                    "party": party,
                    "percentage": pct(value),
                }
            )
        results.sort(key=lambda row: row["percentage"], reverse=True)

        undecided = pct(clean(r[col["Undecided"]]))
        blank = pct(clean(r[col["Blank / null / won't vote"]]))
        percentage_sum = round(
            sum(row["percentage"] for row in results)
            + (undecided or 0)
            + (blank or 0),
            1,
        )

        main_wave = {
            "vintage": clean(r[col["Poll vintage"]]),
            "pollster": clean(r[col["Pollster"]]),
            "fieldwork": clean(r[col["Fieldwork"]]),
            "sample": clean(r[col["Sample / margin"]]),
            "completeness": "Leaders only" if len(results) <= 2 else "Full candidate list",
            "results": results,
            "undecided": undecided,
            "blank": blank,
            "percentageSum": percentage_sum,
            "sourceUrl": clean(r[col["Source URL(s)"]]),
        }

        waves = [main_wave]

        late_row = late_by_uf.get(uf)
        is_already_late_sep = (main_wave["vintage"] or "").lower().startswith("late-sep")
        if late_row is not None and not is_already_late_sep:
            lula_pct = pct(clean(late_row[late_col["Lula (PT)"]]))
            flavio_pct = pct(clean(late_row[late_col["Flávio Bolsonaro (PL)"]]))
            if lula_pct is not None and flavio_pct is not None:
                late_results = [
                    {"candidateName": "Lula", "party": "PT", "percentage": lula_pct},
                    {"candidateName": "Flávio Bolsonaro", "party": "PL", "percentage": flavio_pct},
                ]
                if uf == "GO":
                    late_results.append(
                        {
                            "candidateName": "Ronaldo Caiado",
                            "party": "PSD",
                            "percentage": GOIAS_CAIADO_LATE_SEP_PCT,
                        }
                    )
                late_results.sort(key=lambda row: row["percentage"], reverse=True)
                waves.append(
                    {
                        "vintage": "Late-Sep (apenas líderes divulgados)",
                        "pollster": "Quaest (for TV Globo / affiliates)" if uf != "PI" else "AtlasIntel",
                        "fieldwork": clean(late_row[late_col["Poll / timing"]]),
                        "sample": None,
                        "completeness": "Leaders only",
                        "results": late_results,
                        "undecided": None,
                        "blank": None,
                        "percentageSum": round(sum(x["percentage"] for x in late_results), 1),
                        "sourceUrl": clean(late_row[late_col["Source"]]),
                    }
                )

        states.append(
            {
                "uf": uf,
                "state": clean(r[col["State"]]),
                "region": clean(r[col["Region"]]),
                "waves": waves,
            }
        )

    states.sort(key=lambda s: s["state"] or s["uf"])

    output = {
        "generatedAt": "2026-10-02T00:00:00Z",
        "compiledManually": True,
        "note": (
            "Compilação manual a partir de 9 matérias jornalísticas reais e citadas "
            "(ver `sources`), a maioria pesquisas Quaest/TV Globo de agosto e "
            "setembro de 2026, com Piauí vindo de uma pesquisa AtlasIntel separada "
            "(Quaest não pesquisou o estado). Não é um feed automático: alguns "
            "estados têm só uma rodada (agosto), outros já têm uma rodada mais "
            "nova de final de setembro. Quando a rodada nova só trouxe os 2 "
            "líderes (Lula x Flávio Bolsonaro), isso aparece como uma 2ª 'wave' "
            "marcada como 'Apenas líderes', sem substituir a lista completa mais "
            "antiga. Em Goiás, o 3º nome (Ronaldo Caiado) é incluído na rodada de "
            "setembro porque a própria fonte citou o número dele junto."
        ),
        "readme": readme_lines,
        "sources": sources,
        "states": states,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Gravado {OUTPUT} com {len(states)} UFs.")
    multi_wave = sum(1 for s in states if len(s["waves"]) > 1)
    print(f"{multi_wave} UFs com 2 waves (dado de setembro além de agosto).")


if __name__ == "__main__":
    main()
