#!/usr/bin/env python3
"""Gera JSON de resultados para Presidente 2022 (1º e 2º turno) a partir dos CSVs do TSE.

Entrada: work/tse2022/raw/votacao_candidato_munzona_2022/..._BR.csv e
         work/tse2022/raw/detalhe_votacao_munzona_2022/..._BR.csv
Saída:   work/tse2022/out/presidente/t{1,2}/ (br.json, {uf}.json, zz.json, municipios/{uf}.json)

Todo número sai do CSV. O script valida somas e imprime um relatório no fim.
Uso: nice -n 19 python3 scripts/tse2022-presidente.py
"""
import csv
import json
import os
import sys
import time
from collections import defaultdict

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(BASE, 'work/tse2022/raw')
OUT = os.path.join(BASE, 'work/tse2022/out/presidente')
REF = os.path.join(BASE, 'public/data/municipios')
F_CAND = os.path.join(RAW, 'votacao_candidato_munzona_2022/votacao_candidato_munzona_2022_BR.csv')
F_DET = os.path.join(RAW, 'detalhe_votacao_munzona_2022/detalhe_votacao_munzona_2022_BR.csv')

CAMPOS_TOTAIS = {
    'aptos': 'QT_APTOS',
    'comparecimento': 'QT_COMPARECIMENTO',
    'abstencoes': 'QT_ABSTENCOES',
    'secoes': 'QT_TOTAL_SECOES',
    'validos': 'QT_TOTAL_VOTOS_VALIDOS',
    'brancos': 'QT_VOTOS_BRANCOS',
    'nulos': 'QT_TOTAL_VOTOS_NULOS',
    'anulados': 'QT_TOTAL_VOTOS_ANULADOS',
}
NULOS = {'', '#NULO#', '#NULO', '#NE', '#NE#'}

UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
       'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']


def ler(caminho):
    with open(caminho, encoding='latin-1', newline='') as f:
        for r in csv.DictReader(f, delimiter=';'):
            if r['CD_CARGO'] == '1':
                yield r


def cd_mun(v):
    return str(int(v)).zfill(5)


def main():
    t0 = time.time()
    erros = []
    # totais[turno][(uf, cd)] -> dict ; nomes[(uf, cd)] -> nm
    totais = {1: defaultdict(lambda: dict.fromkeys(CAMPOS_TOTAIS, 0)),
              2: defaultdict(lambda: dict.fromkeys(CAMPOS_TOTAIS, 0))}
    nomes = {}
    for r in ler(F_DET):
        t = int(r['NR_TURNO'])
        chave = (r['SG_UF'], cd_mun(r['CD_MUNICIPIO']))
        nomes[chave] = r['NM_MUNICIPIO']
        acc = totais[t][chave]
        for k, col in CAMPOS_TOTAIS.items():
            acc[k] += int(r[col])

    # votos[turno][(uf, cd)][sq] -> int ; meta[turno][sq] -> dict
    votos = {1: defaultdict(lambda: defaultdict(int)), 2: defaultdict(lambda: defaultdict(int))}
    meta = {1: {}, 2: {}}
    for r in ler(F_CAND):
        t = int(r['NR_TURNO'])
        chave = (r['SG_UF'], cd_mun(r['CD_MUNICIPIO']))
        nomes.setdefault(chave, r['NM_MUNICIPIO'])
        sq = r['SQ_CANDIDATO']
        votos[t][chave][sq] += int(r['QT_VOTOS_NOMINAIS_VALIDOS'])
        if sq not in meta[t]:
            fed = r['SG_FEDERACAO'].strip()
            meta[t][sq] = {
                'sq': sq,
                'numero': int(r['NR_CANDIDATO']),
                'nome': r['NM_URNA_CANDIDATO'],
                'partido': r['SG_PARTIDO'],
                'agremiacao': fed if fed not in NULOS else r['NM_COLIGACAO'],
                'situacao': r['DS_SIT_TOT_TURNO'],
            }

    rel = []
    for t in (1, 2):
        dir_t = os.path.join(OUT, f't{t}')
        os.makedirs(os.path.join(dir_t, 'municipios'), exist_ok=True)
        chaves = set(totais[t]) | set(votos[t])
        sem_det = [c for c in chaves if c not in totais[t]]
        sem_cand = [c for c in chaves if c not in votos[t]]
        if sem_det:
            erros.append(f't{t}: municípios sem detalhe: {sem_det[:10]}')
        if sem_cand:
            erros.append(f't{t}: municípios sem votação de candidato: {sem_cand[:10]}')

        def somar(filtro):
            tot = dict.fromkeys(CAMPOS_TOTAIS, 0)
            vs = defaultdict(int)
            for c in chaves:
                if not filtro(c):
                    continue
                for k, v in totais[t].get(c, {}).items():
                    tot[k] += v
                for sq, v in votos[t].get(c, {}).items():
                    vs[sq] += v
            return tot, vs

        def recorte(uf, tot, vs, cd=None, nm=None, cabecalho=True):
            validos = tot['validos']
            cands = []
            for sq, v in vs.items():
                m = dict(meta[t][sq])
                cands.append({
                    'sq': m['sq'], 'numero': m['numero'], 'nome': m['nome'],
                    'partido': m['partido'], 'agremiacao': m['agremiacao'], 'votos': v,
                    'pct_validos': round(v / validos * 100, 2) if validos else 0.0,
                    'situacao': m['situacao'],
                })
            cands.sort(key=lambda c: (-c['votos'], c['numero']))
            soma = sum(vs.values())
            rotulo = f't{t} {uf}' + (f' {cd} {nm}' if cd else '')
            if soma != validos:
                erros.append(f'{rotulo}: soma candidatos {soma} != validos {validos}')
            o = {}
            if cabecalho:
                o.update({'ano': 2022, 'turno': t, 'cargo': 'Presidente', 'uf': uf})
            if cd is not None:
                o['cd_municipio'] = cd
                o['nm_municipio'] = nm
            o['totais'] = tot
            o['candidatos'] = cands
            return o

        def gravar(caminho, obj):
            with open(caminho, 'w', encoding='utf-8') as f:
                json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))

        br_tot, br_vs = somar(lambda c: True)
        br = recorte('BR', br_tot, br_vs)
        gravar(os.path.join(dir_t, 'br.json'), br)

        soma_uf_tot = dict.fromkeys(CAMPOS_TOTAIS, 0)
        soma_uf_vs = defaultdict(int)
        n_mun = {}
        for uf in UFS + ['ZZ']:
            tot, vs = somar(lambda c, uf=uf: c[0] == uf)
            gravar(os.path.join(dir_t, f'{uf.lower()}.json'), recorte(uf, tot, vs))
            for k, v in tot.items():
                soma_uf_tot[k] += v
            for sq, v in vs.items():
                soma_uf_vs[sq] += v
            muns = [c for c in chaves if c[0] == uf]
            lista = [recorte(uf, totais[t].get(c, dict.fromkeys(CAMPOS_TOTAIS, 0)),
                             votos[t].get(c, {}), cd=c[1], nm=nomes[c], cabecalho=False)
                     for c in muns]
            lista.sort(key=lambda m: (m['nm_municipio'], m['cd_municipio']))
            gravar(os.path.join(dir_t, 'municipios', f'{uf.lower()}.json'),
                   {'ano': 2022, 'turno': t, 'cargo': 'Presidente', 'uf': uf, 'municipios': lista})
            n_mun[uf] = (len(muns), {c[1] for c in muns})

        ufs_presentes = {c[0] for c in chaves}
        extras = ufs_presentes - set(UFS) - {'ZZ'}
        if extras:
            erros.append(f't{t}: UFs inesperadas no CSV: {extras}')
        if soma_uf_tot != br_tot:
            erros.append(f't{t}: soma UFs+ZZ totais != BR: {soma_uf_tot} vs {br_tot}')
        if dict(soma_uf_vs) != dict(br_vs):
            erros.append(f't{t}: soma UFs+ZZ votos != BR')
        rel.append((t, br, n_mun, soma_uf_tot == br_tot and dict(soma_uf_vs) == dict(br_vs)))

    # Relatório
    print('=== Validação ===')
    for t, br, n_mun, ok_soma in rel:
        print(f'\n-- Turno {t} --')
        print(f'Soma UFs+ZZ == BR (votos e totais): {"OK" if ok_soma else "FALHOU"}')
        print('Totais BR:', json.dumps(br['totais'], ensure_ascii=False))
        print(f'Soma votos candidatos BR: {sum(c["votos"] for c in br["candidatos"])}')
        for c in br['candidatos'][:2]:
            print(f'  {c["numero"]} {c["nome"]} ({c["partido"]}): {c["votos"]} votos, '
                  f'{c["pct_validos"]}% dos válidos, {c["situacao"]}')
        print('Municípios por UF (TSE x referência public/data/municipios):')
        difs = []
        for uf in UFS:
            n, cds = n_mun[uf]
            with open(os.path.join(REF, f'{uf.lower()}.json'), encoding='utf-8') as f:
                ref = {m['cd'] for m in json.load(f)}
            so_tse = sorted(cds - ref)
            so_ref = sorted(ref - cds)
            marca = 'OK' if not so_tse and not so_ref else 'DIF'
            difs.append(f'{uf}:{n}/{len(ref)}{"" if marca == "OK" else "!"}')
            if so_tse or so_ref:
                print(f'  {uf}: só no TSE {so_tse} | só na referência {so_ref}')
        print('  ' + ' '.join(difs))
        print(f'  ZZ (exterior): {n_mun["ZZ"][0]} cidades')
    print('\n=== Erros ===')
    if erros:
        for e in erros[:50]:
            print(' ', e)
        print(f'  total: {len(erros)}')
    else:
        print('  nenhum')
    print(f'\nTempo: {time.time() - t0:.1f}s')
    return 1 if erros else 0


if __name__ == '__main__':
    sys.exit(main())
