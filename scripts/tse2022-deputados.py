#!/usr/bin/env python3
# Gera JSON de Deputado Federal (6), Estadual (7) e Distrital (8, DF), 1º turno de 2022,
# a partir dos CSVs de dados abertos do TSE (por UF) já baixados em work/tse2022/raw.
# Todo número sai do CSV; nada é estimado.
# Uso: nice -n 19 python3 scripts/tse2022-deputados.py [UF ...]
import csv, json, os, sys, time, collections
from multiprocessing import Pool

BASE = '/root/variedades/work/tse2022'
RAW = BASE + '/raw'
OUT = BASE + '/out'
MUNREF = '/root/variedades/public/data/municipios'
UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
       'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
CARGOS = {'6': ('Deputado Federal', 'deputado-federal'),
          '7': ('Deputado Estadual', 'deputado-estadual'),
          '8': ('Deputado Distrital', 'deputado-distrital')}
TOT = ['aptos', 'comparecimento', 'abstencoes', 'secoes', 'validos', 'brancos', 'nulos', 'anulados', 'legenda']
# mapeamento campo de saída -> coluna(s) do detalhe_votacao_munzona
DET = {'aptos': ['QT_APTOS'], 'comparecimento': ['QT_COMPARECIMENTO'], 'abstencoes': ['QT_ABSTENCOES'],
       'secoes': ['QT_TOTAL_SECOES'], 'validos': ['QT_TOTAL_VOTOS_VALIDOS'], 'brancos': ['QT_VOTOS_BRANCOS'],
       'nulos': ['QT_TOTAL_VOTOS_NULOS'], 'anulados': ['QT_TOTAL_VOTOS_ANULADOS', 'QT_TOTAL_VOTOS_ANUL_SUBJUD'],
       'legenda': ['QT_TOTAL_VOTOS_LEG_VALIDOS']}


def ler(path):
    with open(path, encoding='latin-1', newline='') as f:
        for r in csv.DictReader(f, delimiter=';'):
            if r['NR_TURNO'] == '1' and r['CD_CARGO'] in CARGOS:
                yield r


def nz(v):
    return '' if v in ('#NULO#', '#NULO', '#NE', '') else v


def pct(v, t):
    return round(v * 100.0 / t, 2) if t else 0.0


def processar(uf):
    t0 = time.time()
    # cand[cargo][sq] = meta; votos[cargo][cd][sq] = int
    meta = collections.defaultdict(dict)
    votos = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    nomes = {}
    for r in ler(f'{RAW}/votacao_candidato_munzona_2022/votacao_candidato_munzona_2022_{uf}.csv'):
        cg = r['CD_CARGO']; sq = r['SQ_CANDIDATO']; cd = r['CD_MUNICIPIO'].zfill(5)
        nomes[cd] = r['NM_MUNICIPIO']
        m = meta[cg].get(sq)
        if m is None:
            part = r['SG_PARTIDO']
            meta[cg][sq] = {'sq': sq, 'numero': int(r['NR_CANDIDATO']), 'nome': r['NM_URNA_CANDIDATO'],
                            'partido': part, 'agremiacao': nz(r['SG_FEDERACAO']) or part,
                            'situacao': r['DS_SIT_TOT_TURNO']}
        votos[cg][cd][sq] += int(r['QT_VOTOS_NOMINAIS_VALIDOS'])
    # totais do detalhe
    tot = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for r in ler(f'{RAW}/detalhe_votacao_munzona_2022/detalhe_votacao_munzona_2022_{uf}.csv'):
        cd = r['CD_MUNICIPIO'].zfill(5); nomes.setdefault(cd, r['NM_MUNICIPIO'])
        c = tot[r['CD_CARGO']][cd]
        for k, cols in DET.items():
            for col in cols:
                c[k] += int(r[col])
    # partidos: nominais e legenda (legenda = QT_TOTAL_VOTOS_LEG_VALIDOS)
    part = collections.defaultdict(lambda: collections.defaultdict(dict))
    pagr = collections.defaultdict(dict)
    for r in ler(f'{RAW}/votacao_partido_munzona_2022/votacao_partido_munzona_2022_{uf}.csv'):
        cg = r['CD_CARGO']; cd = r['CD_MUNICIPIO'].zfill(5); p = r['SG_PARTIDO']
        pagr[cg][p] = nz(r['SG_FEDERACAO']) or p
        d = part[cg][cd].setdefault(p, [0, 0])
        d[0] += int(r['QT_VOTOS_NOMINAIS_VALIDOS']); d[1] += int(r['QT_TOTAL_VOTOS_LEG_VALIDOS'])

    relat = {'uf': uf, 'cargos': {}}
    for cg in sorted(set(meta) | set(tot)):
        cargo, slug = CARGOS[cg]
        cds = sorted(set(votos[cg]) | set(tot[cg]) | set(part[cg]))
        # agrega UF
        tuf = collections.Counter(); vuf = collections.Counter(); puf = collections.defaultdict(lambda: [0, 0])
        for cd in cds:
            tuf.update(tot[cg][cd]); vuf.update(votos[cg][cd])
            for p, (n, l) in part[cg][cd].items():
                puf[p][0] += n; puf[p][1] += l
        totais = {k: tuf[k] for k in TOT}
        val = totais['validos']
        cands = []
        for sq, m in meta[cg].items():
            c = dict(m); c['votos'] = vuf[sq]; c['pct_validos'] = pct(vuf[sq], val)
            cands.append({k: c[k] for k in ('sq', 'numero', 'nome', 'partido', 'agremiacao', 'votos', 'pct_validos', 'situacao')})
        cands.sort(key=lambda c: (-c['votos'], c['nome']))
        partidos = [{'partido': p, 'agremiacao': pagr[cg][p], 'nominais': n, 'legenda': l, 'total': n + l,
                     'pct_validos': pct(n + l, val)} for p, (n, l) in puf.items()]
        partidos.sort(key=lambda x: (-x['total'], x['partido']))
        rec = {'ano': 2022, 'turno': 1, 'cargo': cargo, 'uf': uf, 'totais': totais,
               'candidatos': cands, 'partidos': partidos}
        d = f'{OUT}/{slug}/t1'
        os.makedirs(d + '/municipios', exist_ok=True)
        with open(f'{d}/{uf.lower()}.json', 'w', encoding='utf-8') as f:
            json.dump(rec, f, ensure_ascii=False, separators=(',', ':'))
        muns = []
        soma_mun = collections.Counter(); soma_cand_mun = 0
        for cd in cds:
            t = {k: tot[cg][cd][k] for k in TOT}
            soma_mun.update(t)
            cl = sorted(((sq, v) for sq, v in votos[cg][cd].items() if v > 0), key=lambda x: (-x[1], x[0]))
            soma_cand_mun += sum(v for _, v in cl)
            pl = sorted(([p, n, l] for p, (n, l) in part[cg][cd].items() if n + l > 0), key=lambda x: (-(x[1] + x[2]), x[0]))
            muns.append({'cd_municipio': cd, 'nm_municipio': nomes.get(cd, ''), 'totais': t,
                         'candidatos': [[sq, v] for sq, v in cl], 'partidos': pl})
        with open(f'{d}/municipios/{uf.lower()}.json', 'w', encoding='utf-8') as f:
            json.dump({'ano': 2022, 'turno': 1, 'cargo': cargo, 'uf': uf, 'municipios': muns},
                      f, ensure_ascii=False, separators=(',', ':'))
        nom = sum(vuf.values())
        eleitos = [c for c in cands if c['situacao'].startswith('ELEITO')]
        relat['cargos'][cg] = {
            'cargo': cargo, 'validos': val, 'nominais': nom, 'legenda': totais['legenda'],
            'dif_val': nom + totais['legenda'] - val,
            'dif_part_nom': sum(n for n, _ in puf.values()) - nom,
            'dif_part_leg': sum(l for _, l in puf.values()) - totais['legenda'],
            'mun_ok': all(soma_mun[k] == totais[k] for k in TOT) and soma_cand_mun == nom,
            'n_mun': len(cds), 'eleitos': len(eleitos),
            'top': (cands[0]['nome'], cands[0]['votos']) if cands else None,
            'tam_uf': os.path.getsize(f'{d}/{uf.lower()}.json'),
            'tam_mun': os.path.getsize(f'{d}/municipios/{uf.lower()}.json'),
            'subjud': tuf['anulados'],
        }
    relat['seg'] = round(time.time() - t0, 1)
    return relat


def main():
    t0 = time.time()
    ufs = [u.upper() for u in sys.argv[1:]] or UFS
    # maiores primeiro para equilibrar o pool; 3 processos (limite combinado com outros agentes)
    ordem = sorted(ufs, key=lambda u: -os.path.getsize(f'{RAW}/votacao_candidato_munzona_2022/votacao_candidato_munzona_2022_{u}.csv'))
    with Pool(3) as pool:
        res = {r['uf']: r for r in pool.imap_unordered(processar, ordem)}
    print('UF cargo validos nominais legenda dif(nom+leg-val) difPartNom difPartLeg anulados munOK nMun ref eleitos tamUF tamMun seg')
    elf = 0; ele = 0; top = {}
    for uf in ufs:
        r = res[uf]
        ref = len(json.load(open(f'{MUNREF}/{uf.lower()}.json')))
        for cg, c in sorted(r['cargos'].items()):
            print(uf, c['cargo'], c['validos'], c['nominais'], c['legenda'], c['dif_val'], c['dif_part_nom'],
                  c['dif_part_leg'], c['subjud'], c['mun_ok'], c['n_mun'], ref, c['eleitos'], c['tam_uf'], c['tam_mun'], r['seg'])
            if cg == '6': elf += c['eleitos']
            else: ele += c['eleitos']
            if c['top'] and (cg not in top or c['top'][1] > top[cg][2]):
                top[cg] = (c['top'][0], uf, c['top'][1])
    print('Eleitos federal:', elf, '| estaduais+distritais:', ele)
    for cg, t in sorted(top.items()):
        print('Mais votado', CARGOS[cg][0], t)
    print('Tempo total s:', round(time.time() - t0, 1))


if __name__ == '__main__':
    main()
