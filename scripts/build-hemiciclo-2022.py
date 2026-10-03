#!/usr/bin/env python3
"""Bancada eleita para Deputado Federal em 2022, por UF e partido.

Lê o resultado final de 2022 já processado (scripts/tse2022-deputados.py,
work/tse2022/out/deputado-federal/t1/{uf}.json) e grava
public/data/hemiciclo-2022.json, base do hemiciclo da Composição Parlamentar.
Conta como eleito quem tem situação "ELEITO POR QP" ou "ELEITO POR MÉDIA".
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'work' / 'tse2022' / 'out' / 'deputado-federal' / 't1'
OUT = ROOT / 'public' / 'data' / 'hemiciclo-2022.json'


def party_key(sigla: str) -> str:
    return sigla.upper().replace(' ', '')


ufs = {}
for path in sorted(SRC.glob('[a-z][a-z].json')):
    data = json.loads(path.read_text())
    if data.get('uf', '').upper() in ('BR', 'ZZ'):
        continue
    eleitos = {}
    for cand in data['candidatos']:
        if cand.get('situacao', '').upper().startswith('ELEITO'):
            key = party_key(cand['partido'])
            eleitos[key] = eleitos.get(key, 0) + 1
    vagas = sum(eleitos.values())
    ufs[data['uf'].upper()] = {'vagas': vagas, 'eleitos': dict(sorted(eleitos.items(), key=lambda kv: (-kv[1], kv[0])))}

total = sum(uf['vagas'] for uf in ufs.values())
if len(ufs) != 27 or total != 513:
    sys.exit(f'esperado 27 UFs e 513 eleitos, veio {len(ufs)} UFs e {total}')

OUT.write_text(json.dumps({
    'ano': 2022,
    'cargo': 'Deputado Federal',
    'fonte': 'TSE, dados abertos (votacao_candidato_munzona_2022), situação de totalização',
    'vagas': total,
    'ufs': ufs,
}, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'{OUT.relative_to(ROOT)}: {len(ufs)} UFs, {total} eleitos, {OUT.stat().st_size} bytes')
