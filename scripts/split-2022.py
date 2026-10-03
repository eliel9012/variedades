#!/usr/bin/env python3
"""Reorganiza o resultado de 2022 para abrir rápido no site.

Lê work/tse2022/out (gerado por scripts/tse2022-*.py) e grava, no mesmo lugar:
- {cargo}/t{n}/municipios/{uf}/{cd}.json: um município por arquivo, no mesmo
  formato de cada item de municipios/{uf}.json. A página de uma cidade baixa
  só ele, em vez do arquivo da UF inteira (deputado federal em SP: 4,7 MB).
- presidente/t{n}/mapa.json: líder e segundo de cada UF, no formato do br.json
  de Governador/Senador. O mapa de Presidente faz 1 pedido em vez de 27.
Os dados não mudam, só a divisão em arquivos. Pode rodar de novo à vontade.
"""
import json
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / 'work' / 'tse2022' / 'out'


def dump(path: pathlib.Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))


cities = 0
for listing in sorted(OUT.glob('*/t[12]/municipios/[a-z][a-z].json')):
    data = json.loads(listing.read_text())
    target = listing.with_suffix('')
    for item in data['municipios']:
        dump(target / f"{item['cd_municipio']}.json", item)
        cities += 1
print(f'{cities} arquivos por município')

for turno_dir in sorted((OUT / 'presidente').glob('t[12]')):
    ufs = {}
    for path in sorted(turno_dir.glob('[a-z][a-z].json')):
        recorte = json.loads(path.read_text())
        uf = recorte['uf'].upper()
        if uf in ('BR', 'ZZ'):
            continue
        ranking = sorted(recorte['candidatos'], key=lambda c: -c['votos'])
        if ranking:
            ufs[uf] = {'lider': ranking[0], 'segundo': ranking[1] if len(ranking) > 1 else None, 'validos': recorte['totais']['validos']}
    dump(turno_dir / 'mapa.json', {'ano': 2022, 'turno': int(turno_dir.name[1]), 'cargo': 'Presidente', 'ufs': ufs})
    print(f'{turno_dir.relative_to(OUT)}/mapa.json: {len(ufs)} UFs')
