#!/usr/bin/env python3
# Apura Brasil: agrega resultados TSE 2022 de Governador (cargo 3, turnos 1 e 2)
# e Senador (cargo 5, turno 1) por UF e por município, a partir dos CSVs abertos do TSE.
# Todo número sai dos CSVs em work/tse2022/raw. Nada é estimado.
# Uso: nice -n 19 python3 scripts/tse2022-gov-sen.py
import csv, io, json, os, subprocess, sys, time
from multiprocessing import Pool

BASE = '/root/variedades/work/tse2022'
RAW = BASE + '/raw'
OUT = BASE + '/out'
MUNREF = '/root/variedades/public/data/municipios'
UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
       'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
CARGOS = {3: ('Governador', 'governador'), 5: ('Senador', 'senador')}
TOT_CAMPOS = [('aptos', 'QT_APTOS'), ('comparecimento', 'QT_COMPARECIMENTO'),
              ('abstencoes', 'QT_ABSTENCOES'), ('secoes', 'QT_TOTAL_SECOES'),
              ('validos', 'QT_TOTAL_VOTOS_VALIDOS'), ('brancos', 'QT_VOTOS_BRANCOS'),
              ('nulos', 'QT_TOTAL_VOTOS_NULOS'), ('anulados', 'QT_TOTAL_VOTOS_ANULADOS')]
# campos extras do detalhe usados só na validação (sub judice)
EXTRA = ['QT_TOTAL_VOTOS_ANUL_SUBJUD', 'QT_VOTOS_NOMINAIS_VALIDOS', 'QT_TOTAL_VOTOS_LEG_VALIDOS']


def cd5(v):
    return str(int(v)).zfill(5)


def ler_filtrado(caminho, padrao):
    """Lê o CSV com pré-filtro via grep (rápido em arquivos de 1 GB); devolve dicts."""
    with open(caminho, 'rb') as f:
        header = f.readline().decode('latin-1').strip()
    cols = next(csv.reader([header], delimiter=';'))
    p = subprocess.Popen(['/usr/bin/grep', '-a', '-E', padrao, caminho], stdout=subprocess.PIPE)
    txt = io.TextIOWrapper(p.stdout, encoding='latin-1', newline='')
    for row in csv.reader(txt, delimiter=';'):
        if len(row) != len(cols):
            continue
        yield dict(zip(cols, row))
    p.wait()


def novo_tot():
    d = {k: 0 for k, _ in TOT_CAMPOS}
    for e in EXTRA:
        d[e] = 0
    return d


def processa_uf(uf):
    t0 = time.time()
    # chave: (cargo, turno) -> {'uf': tot, 'mun': {cd: tot}, 'nm': {cd: nome}}
    det = {}
    pad_det = r';"?(3|5)"?;"(Governador|Senador)";'
    for r in ler_filtrado(f'{RAW}/detalhe_votacao_munzona_2022/detalhe_votacao_munzona_2022_{uf}.csv', pad_det):
        cargo = int(r['CD_CARGO'])
        if cargo not in CARGOS:
            continue
        turno = int(r['NR_TURNO'])
        k = (cargo, turno)
        g = det.setdefault(k, {'uf': novo_tot(), 'mun': {}, 'nm': {}})
        cd = cd5(r['CD_MUNICIPIO'])
        g['nm'][cd] = r['NM_MUNICIPIO']
        m = g['mun'].setdefault(cd, novo_tot())
        for chave, col in TOT_CAMPOS:
            v = int(r[col])
            g['uf'][chave] += v
            m[chave] += v
        for e in EXTRA:
            v = int(r[e])
            g['uf'][e] += v
            m[e] += v

    # votos por candidato
    cand = {}  # k -> {'info': {sq: dict}, 'uf': {sq: votos}, 'mun': {cd: {sq: votos}}, 'nominais': {sq: votos}}
    pad_c = r';"?(3|5)"?;"(Governador|Senador)";'
    for r in ler_filtrado(f'{RAW}/votacao_candidato_munzona_2022/votacao_candidato_munzona_2022_{uf}.csv', pad_c):
        cargo = int(r['CD_CARGO'])
        if cargo not in CARGOS:
            continue
        turno = int(r['NR_TURNO'])
        k = (cargo, turno)
        g = cand.setdefault(k, {'info': {}, 'uf': {}, 'mun': {}, 'nom': {}, 'nm': {}})
        sq = r['SQ_CANDIDATO']
        if sq not in g['info']:
            fed = r['SG_FEDERACAO']
            agr = fed if fed and not fed.startswith('#N') else r['NM_COLIGACAO']
            g['info'][sq] = {'sq': sq, 'numero': int(r['NR_CANDIDATO']), 'nome': r['NM_URNA_CANDIDATO'],
                             'partido': r['SG_PARTIDO'], 'agremiacao': agr,
                             'situacao': r['DS_SIT_TOT_TURNO']}
        v = int(r['QT_VOTOS_NOMINAIS_VALIDOS'])
        g['uf'][sq] = g['uf'].get(sq, 0) + v
        g['nom'][sq] = g['nom'].get(sq, 0) + int(r['QT_VOTOS_NOMINAIS'])
        cd = cd5(r['CD_MUNICIPIO'])
        g['nm'][cd] = r['NM_MUNICIPIO']
        mm = g['mun'].setdefault(cd, {})
        mm[sq] = mm.get(sq, 0) + v

    rel = {'uf': uf, 'tempo': 0, 'recortes': []}
    for k in sorted(set(det) | set(cand)):
        cargo, turno = k
        nome_cargo, pasta = CARGOS[cargo]
        d = det.get(k)
        c = cand.get(k)
        info = {'k': [cargo, turno], 'erros': []}
        if not d or not c:
            info['erros'].append(f'faltando {"detalhe" if not d else "candidato"}')
            rel['recortes'].append(info)
            continue

        def lista(votos_map, validos):
            out = []
            for sq, vt in votos_map.items():
                x = dict(c['info'][sq])
                x['votos'] = vt
                x['pct_validos'] = round(vt / validos * 100, 2) if validos else 0.0
                out.append(x)
            out.sort(key=lambda x: (-x['votos'], x['numero']))
            # ordem de chaves exata do esquema
            return [{kk: x[kk] for kk in ('sq', 'numero', 'nome', 'partido', 'agremiacao', 'votos',
                                            'pct_validos', 'situacao')} for x in out]

        def tot(t):
            return {kk: t[kk] for kk, _ in TOT_CAMPOS}

        rec_uf = {'ano': 2022, 'turno': turno, 'cargo': nome_cargo, 'uf': uf,
                  'totais': tot(d['uf']), 'candidatos': lista(c['uf'], d['uf']['validos'])}
        muns = []
        cds = set(d['mun']) | set(c['mun'])
        mun_diff = []
        soma_mun_validos = 0
        soma_mun_cand = {}
        for cd in cds:
            tm = d['mun'].get(cd)
            vm = c['mun'].get(cd, {})
            if tm is None:
                info['erros'].append(f'municipio {cd} sem detalhe')
                continue
            nm = d['nm'].get(cd) or c['nm'].get(cd)
            cl = lista(vm, tm['validos'])
            s = sum(x['votos'] for x in cl)
            if s != tm['validos']:
                mun_diff.append((cd, nm, s, tm['validos'], tm['QT_TOTAL_VOTOS_ANUL_SUBJUD']))
            soma_mun_validos += tm['validos']
            for sq, vt in vm.items():
                soma_mun_cand[sq] = soma_mun_cand.get(sq, 0) + vt
            muns.append({'cd_municipio': cd, 'nm_municipio': nm, 'totais': tot(tm), 'candidatos': cl})
        muns.sort(key=lambda m: (m['nm_municipio'], m['cd_municipio']))

        dirp = f'{OUT}/{pasta}/t{turno}'
        os.makedirs(dirp + '/municipios', exist_ok=True)
        with open(f'{dirp}/{uf.lower()}.json', 'w', encoding='utf-8') as f:
            json.dump(rec_uf, f, ensure_ascii=False, separators=(',', ':'))
        with open(f'{dirp}/municipios/{uf.lower()}.json', 'w', encoding='utf-8') as f:
            json.dump({'ano': 2022, 'turno': turno, 'cargo': nome_cargo, 'uf': uf, 'municipios': muns},
                      f, ensure_ascii=False, separators=(',', ':'))

        soma_uf = sum(x['votos'] for x in rec_uf['candidatos'])
        info.update({
            'validos': d['uf']['validos'], 'soma_cand': soma_uf,
            'nominais_validos_det': d['uf']['QT_VOTOS_NOMINAIS_VALIDOS'],
            'leg_validos_det': d['uf']['QT_TOTAL_VOTOS_LEG_VALIDOS'],
            'anulados': d['uf']['anulados'], 'anul_subjud': d['uf']['QT_TOTAL_VOTOS_ANUL_SUBJUD'],
            'soma_nominais_todos': sum(c['nom'].values()),
            'n_mun': len(muns), 'mun_diff': mun_diff[:5], 'n_mun_diff': len(mun_diff),
            'soma_mun_validos_ok': soma_mun_validos == d['uf']['validos'],
            'soma_mun_cand_ok': soma_mun_cand == c['uf'],
            'soma_mun_tot_ok': all(sum(m['totais'][kk] for m in muns) == rec_uf['totais'][kk]
                                   for kk, _ in TOT_CAMPOS),
            'mun_cds': sorted(m['cd_municipio'] for m in muns),
            'top': rec_uf['candidatos'][:2],
            'eleitos': [x for x in rec_uf['candidatos'] if x['situacao'].upper().startswith('ELEITO')],
        })
        rel['recortes'].append(info)
    rel['tempo'] = round(time.time() - t0, 1)
    return rel


def main():
    t0 = time.time()
    # maiores primeiro para equilibrar; 2 workers, cada um com 1 grep = 4 processos (limite do servidor)
    ordem = sorted(UFS, key=lambda u: -os.path.getsize(
        f'{RAW}/votacao_candidato_munzona_2022/votacao_candidato_munzona_2022_{u}.csv'))
    with Pool(2) as p:
        rels = p.map(processa_uf, ordem, chunksize=1)
    rels.sort(key=lambda r: r['uf'])

    # br.json por cargo/turno
    br = {}
    for r in rels:
        for rc in r['recortes']:
            if 'top' not in rc:
                continue
            cargo, turno = rc['k']
            e = br.setdefault((cargo, turno), {'ano': 2022, 'turno': turno, 'cargo': CARGOS[cargo][0], 'ufs': {}})
            top = rc['top']
            e['ufs'][r['uf']] = {'lider': top[0] if top else None, 'segundo': top[1] if len(top) > 1 else None,
                                 'validos': rc['validos']}
    for (cargo, turno), e in br.items():
        with open(f'{OUT}/{CARGOS[cargo][1]}/t{turno}/br.json', 'w', encoding='utf-8') as f:
            json.dump(e, f, ensure_ascii=False, separators=(',', ':'))

    # relatório de validação
    print('== VALIDACAO ==')
    for r in rels:
        for rc in r['recortes']:
            cargo, turno = rc['k']
            tag = f"{r['uf']} {CARGOS[cargo][0][:3]} t{turno}"
            if rc['erros'] and 'top' not in rc:
                print(tag, 'ERRO', rc['erros']); continue
            ok = rc['soma_cand'] == rc['validos']
            print(f"{tag}: validos={rc['validos']} soma_cand={rc['soma_cand']} {'OK' if ok else 'DIF=' + str(rc['soma_cand'] - rc['validos'])}"
                  f" anulados={rc['anulados']} subjud={rc['anul_subjud']} leg={rc['leg_validos_det']}"
                  f" mun={rc['n_mun']} mun_dif={rc['n_mun_diff']} somaMun(validos/cand/totais)="
                  f"{rc['soma_mun_validos_ok']}/{rc['soma_mun_cand_ok']}/{rc['soma_mun_tot_ok']}"
                  + (f" ERROS={rc['erros']}" if rc['erros'] else '')
                  + (f" exemplos={rc['mun_diff']}" if rc['mun_diff'] else ''))

    print('\n== MUNICIPIOS vs public/data/municipios ==')
    for r in rels:
        rc = next((x for x in r['recortes'] if x['k'] == [3, 1] and 'mun_cds' in x), None)
        if not rc:
            continue
        try:
            ref = json.load(open(f"{MUNREF}/{r['uf'].lower()}.json", encoding='utf-8'))
            refcd = {m['cd'] for m in ref}
        except Exception as ex:
            print(r['uf'], 'sem referencia', ex); continue
        tse = set(rc['mun_cds'])
        so_tse = sorted(tse - refcd); so_ref = sorted(refcd - tse)
        print(f"{r['uf']}: csv={len(tse)} ref={len(refcd)}" + (f" so_csv={so_tse}" if so_tse else '')
              + (f" so_ref={so_ref}" if so_ref else ''))
        # mesmos municípios no senado e no 2o turno
        for rc2 in r['recortes']:
            if 'mun_cds' in rc2 and set(rc2['mun_cds']) != tse:
                print('   difere em', rc2['k'])

    print('\n== UFs com 2o turno de Governador ==')
    print(' '.join(r['uf'] for r in rels if any(x['k'] == [3, 2] for x in r['recortes'])))

    def fmt(x):
        return f"{x['nome']} ({x['partido']}) {x['pct_validos']:.2f}% [{x['situacao']}]"

    print('\n== GOVERNADOR ELEITO por UF ==')
    for r in rels:
        el = []
        for t in (1, 2):
            rc = next((x for x in r['recortes'] if x['k'] == [3, t] and 'eleitos' in x), None)
            if rc and rc['eleitos']:
                el.append(f"t{t}: " + '; '.join(fmt(x) for x in rc['eleitos']))
        print(f"{r['uf']}: " + (' | '.join(el) or 'NENHUM ELEITO NO CSV'))
    print('\n== SENADOR ELEITO por UF ==')
    for r in rels:
        rc = next((x for x in r['recortes'] if x['k'] == [5, 1] and 'eleitos' in x), None)
        print(f"{r['uf']}: " + ('; '.join(fmt(x) for x in rc['eleitos']) if rc and rc['eleitos'] else 'NENHUM ELEITO NO CSV'))

    print('\ntempo por UF:', ' '.join(f"{r['uf']}={r['tempo']}s" for r in rels))
    print(f'tempo total: {time.time() - t0:.1f}s')
    for p in ('governador', 'senador'):
        print(subprocess.run(['du', '-sh', f'{OUT}/{p}'], capture_output=True, text=True).stdout.strip())


if __name__ == '__main__':
    main()
