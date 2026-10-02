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
import re
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


MONTH_ABBR = {
    "jan": 1, "fev": 2, "feb": 2, "mar": 3, "abr": 4, "apr": 4, "mai": 5, "may": 5,
    "jun": 6, "jul": 7, "ago": 8, "aug": 8, "set": 9, "sep": 9, "out": 10, "oct": 10,
    "nov": 11, "dez": 12, "dec": 12,
}


def parse_fieldwork_end(fieldwork):
    """Extrai (ano, mes, dia-final) de um texto livre tipo "8-10 Sep 2026" ou
    "8 Sep 2026", pra comparar qual pesquisa é mais recente quando um mesmo
    estado tem mais de uma na planilha (ver pick_most_recent_group). Retorna
    None se o texto não casar o padrão esperado, nunca inventa uma data."""
    if not fieldwork:
        return None
    match = re.search(r"(\d{1,2})(?:[–\-](\d{1,2}))?\s+([A-Za-zçÇ]{3,})\s+(\d{4})", fieldwork)
    if not match:
        return None
    start_day, end_day, month_raw, year = match.groups()
    month = MONTH_ABBR.get(month_raw[:3].lower())
    if month is None:
        return None
    day = int(end_day or start_day)
    return (int(year), month, day)


def pick_most_recent_group(uf, groups):
    """Quando a planilha tem mais de uma pesquisa pro mesmo estado (achado real:
    SP tinha Datafolha 8-10 Sep e Quaest 4-7 Sep compiladas por engano num único
    card, com candidatos duplicados), mantém só a mais recente por fieldwork,
    igual à convenção já usada para Presidente/Governador (nunca mistura ondas
    de pesquisas diferentes num card só). Nunca derruba a conversão: se a data
    não puder ser comparada, mantém a primeira pesquisa encontrada na planilha."""
    if len(groups) == 1:
        return groups[0]
    dated = [(parse_fieldwork_end(g["fieldwork"]), g) for g in groups]
    if all(d is not None for d, _ in dated):
        dated.sort(key=lambda item: item[0], reverse=True)
        return dated[0][1]
    print(
        f"aviso: {uf} tem {len(groups)} pesquisas na planilha e não foi possível "
        f"comparar as datas de campo; mantendo a primeira encontrada ({groups[0]['pollster']})."
    )
    return groups[0]


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

    # Agrupa por (UF, instituto, campo), não só por UF: a planilha pode ter mais
    # de uma pesquisa pro mesmo estado (achado real: SP tinha Datafolha e Quaest
    # nas mesmas linhas), e misturá-las num card só duplica candidato (mesma
    # "candidateName" duas vezes), o que quebra a renderização em React (key
    # duplicada) e mostra números que não somam 100% de forma nenhuma pesquisa
    # real sozinha.
    by_group = {}
    uf_group_order = {}
    for r in rows[1:]:
        if not r[col["UF"]]:
            continue
        uf = clean(r[col["UF"]])
        pollster = clean(r[col["Pollster"]])
        fieldwork = clean(r[col["Fieldwork"]])
        group_key = (uf, pollster, fieldwork)
        entry = by_group.setdefault(
            group_key,
            {
                "uf": uf,
                "state": clean(r[col["State"]]),
                "pollster": pollster,
                "fieldwork": fieldwork,
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
        if group_key not in uf_group_order.setdefault(uf, []):
            uf_group_order[uf].append(group_key)
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

    states = [
        pick_most_recent_group(uf, [by_group[key] for key in keys])
        for uf, keys in uf_group_order.items()
    ]
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
