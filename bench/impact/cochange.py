#!/usr/bin/env python3
"""cochange.py [--set dev|holdout|all] [--seeds N] [-j N] [--json out.json]  — does `impact` name what a real fix changed?

The question the impact issues (#761 #762 #764) are about: given ONE declaration a real fix changed as the seed, does the
answer contain the OTHER declarations that same fix changed? The Defects4J arena supplies both sides — the fix's patch maps
onto the graph's declarations through `axiomcode changed`, so seed and truth are read the same way, from the same commit.

For every fix with ≥ 2 changed declarations in ≥ 1 file, each changed declaration is used as the seed in turn (capped by
--seeds). The other changed declarations are the truth. Scored:

  recall        truth declarations named anywhere in the answer (contract, direct, reached)
  by layer      where each was found — contract / produces-writes / reads-uses / reached-only — and at which certainty
  precision@direct  of the direct rows, the share that the fix actually changed (a floor: a row can be right and untouched)
  answer size   direct rows and reached callables, so a recall gain bought with noise is visible
  miss kinds    same file · same package · elsewhere — the categories #762 is about

THE SPLIT IS A CONTRACT (bench/impact/SPLIT.md): tune on `dev`, score `holdout` ONCE when the work is done. A change made
while looking at a holdout number has spent that instance — move it to dev in the same commit."""
import collections, json, os, re, subprocess, sys, tempfile, concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
ARENA = os.path.expanduser('~/Documents/ResearchAxiomCode/benchmark-test-impact/agentloc/arena')
WORK = os.path.expanduser('~/Documents/ResearchAxiomCode/benchmark-test-impact/.work')
SCR = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')

def split():
    s = json.load(open(os.path.join(HERE, 'split.json')))
    return s['dev'], s['holdout']

def changed_decls(case):
    """the declarations the fix changed, read by `axiomcode changed` on the buggy vs fixed text of each file it touched"""
    d = os.path.join(ARENA, case); c = json.load(open(os.path.join(d, 'case.json'))); ax = os.path.join(d, 'ax')
    patch = os.path.join(WORK, c['bug'], 'meta', 'src.patch')
    if not os.path.exists(patch) or not os.path.exists(os.path.join(ax, '.axiomcode/out/graph.sqlite')): return None, None
    files = re.findall(r'^diff --git a/(\S+) b/', open(patch).read(), re.M)
    out = []
    with tempfile.TemporaryDirectory() as T:
        for rel in files:
            buggy = os.path.join(ax, rel)
            if not os.path.exists(buggy): continue
            shadow = os.path.join(T, 'shadow'); os.makedirs(os.path.dirname(os.path.join(shadow, rel)), exist_ok=True)
            subprocess.run(['cp', buggy, os.path.join(shadow, rel)])
            one = os.path.join(T, 'one.patch'); txt = open(patch).read()
            m = re.search(rf'^diff --git a/{re.escape(rel)} b/.*?(?=^diff --git |\Z)', txt, re.M | re.S)
            open(one, 'w').write(m.group(0))
            if subprocess.run(['patch', '-R', '-p1', '-s', '-f', '-i', one], cwd=shadow, capture_output=True).returncode: continue
            r = subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-changed'), ax, '--old', buggy,
                                '--new', os.path.join(shadow, rel), '--file', rel, '--json'], capture_output=True, text=True)
            try: j = json.loads(r.stdout)
            except Exception: continue
            for e in j.get('changed', []):
                if e.get('target') and e['kind'] != 'added' and '/test' not in e['file'] and not re.search(r'Tests?\.java$', e['file']):
                    out.append((e['symbol'], e['file'], e.get('target_kind') or 'method', e['target']))
    return ax, list(dict.fromkeys(out))

def run_seed(args):
    ax, seed, truth, case = args
    r = subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-impact'), seed[3], ax, '--json', '--depth', '12']
                       + (['--kind', seed[2]] if seed[2] not in ('param',) and '(' not in seed[3] else []), capture_output=True, text=True)
    try: j = json.loads(r.stdout)
    except Exception: return dict(case=case, seed=seed[0], error=(r.stdout + r.stderr).strip().split('\n')[-1][:120])
    simple = lambda d: d.split('.')[-1]
    where = {}
    for c_ in j.get('contract', []): where.setdefault(c_['display'], ('contract', 'contract'))
    for d_ in j.get('direct', []): where.setdefault(d_['display'], ('produces/writes' if d_['role'] in ('produces', 'writes') else 'reads/uses', d_['certainty']))
    for m_ in j.get('reached', []): where.setdefault(m_['display'], ('reached', 'reached'))
    hit = {}; miss = []
    for t in truth:
        w = where.get(t[0]) or next((v for k, v in where.items() if simple(k) == simple(t[0]) and k.split('.')[-2:] == t[0].split('.')[-2:]), None)
        if w: hit[t[0]] = w
        else: miss.append(('same file' if t[1] == seed[1] else 'same package' if os.path.dirname(t[1]) == os.path.dirname(seed[1]) else 'elsewhere', t[0]))
    changed_set = {t[0] for t in truth} | {seed[0]}
    direct_rows = [d_['display'] for d_ in j.get('direct', [])]
    return dict(case=case, seed=seed[0], truth=len(truth), hit={k: list(v) for k, v in hit.items()}, miss=miss,
                direct=len(direct_rows), direct_right=len([x for x in direct_rows if x in changed_set]), reached=len(j.get('reached', [])),
                tests=len(j.get('tests', [])), unresolved=j.get('unresolved_inside', 0))

def main(argv):
    a = list(argv); which = 'dev'; seeds_cap = 3; jobs = 2; outf = None
    for f, conv in (('--set', str), ('--seeds', int), ('-j', int), ('--json', str)):
        if f in a:
            i = a.index(f); v = conv(a[i + 1]); del a[i:i + 2]
            which = v if f == '--set' else which; seeds_cap = v if f == '--seeds' else seeds_cap
            jobs = v if f == '-j' else jobs; outf = v if f == '--json' else outf
    dev, hold = split(); cases = a or (dev if which == 'dev' else hold if which == 'holdout' else dev + hold)
    jobs_list = []
    for case in cases:
        ax, decls = changed_decls(case)
        if not decls or len(decls) < 2: continue
        for seed in decls[:seeds_cap]:
            truth = [d for d in decls if d[0] != seed[0]]
            if truth: jobs_list.append((ax, seed, truth, case))
    rows = []
    with cf.ThreadPoolExecutor(jobs) as ex:
        for r in ex.map(run_seed, jobs_list): rows.append(r)
    ok = [r for r in rows if 'error' not in r]
    T = sum(r['truth'] for r in ok); H = sum(len(r['hit']) for r in ok)
    layers = collections.Counter(v[0] for r in ok for v in r['hit'].values())
    certs = collections.Counter(v[1] for r in ok for v in r['hit'].values())
    misses = collections.Counter(m[0] for r in ok for m in r['miss'])
    dr = sum(r['direct'] for r in ok); drr = sum(r['direct_right'] for r in ok)
    print(f"{which}: {len(cases)} fixes, {len(ok)} seeds scored ({len(rows) - len(ok)} errors)")
    print(f"  co-change recall   {H}/{T} = {H / max(T, 1):.3f}          (a declaration the same fix changed, named anywhere in the answer)")
    print(f"  found in           " + ', '.join(f"{k} {v}" for k, v in layers.most_common()))
    print(f"  at certainty       " + ', '.join(f"{k} {v}" for k, v in certs.most_common()))
    print(f"  missed             " + ', '.join(f"{k} {v}" for k, v in misses.most_common()) + f"   (of {T - H})")
    print(f"  direct rows        {dr} total, {drr} of them the fix also changed = {drr / max(dr, 1):.3f} (a floor, not precision)")
    print(f"  mean answer        {dr // max(len(ok), 1)} direct, {sum(r['reached'] for r in ok) // max(len(ok), 1)} reached, {sum(r['tests'] for r in ok) // max(len(ok), 1)} tests")
    if outf: json.dump(rows, open(outf, 'w'), indent=1)
    return 0

if __name__ == '__main__': sys.exit(main(sys.argv[1:]))
