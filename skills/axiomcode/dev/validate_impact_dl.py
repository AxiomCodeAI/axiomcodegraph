#!/usr/bin/env python3
"""validate_impact_dl.py <repo> [--n N] [--seed S] [method …] [--truth]

Two things, from one Soufflé run over the graph's own tables (dev/dl/reach.dl):

  1. CHECK   the closure `impact` prints (TRANSITIVE by hop, VERIFY test files) against an independent Datalog
             restatement of the same rules. Any difference is a bug in one of the two.
  2. BOUND   the optimistic closure — every unresolved site treated as a call to the client method written at it —
             and the tests it reaches that the sound closure cannot. With --truth (a bench/mutation mutation.json in the
             tree) it says how many failing test files the sound answer missed and the by-name bound recovers, and how
             much precision that costs. The `bridge` relation names the single unresolved site per recovered path.
"""
import sys, os, re, json, sqlite3, subprocess, random, tempfile, collections
HERE = os.path.dirname(os.path.abspath(__file__)); AX = os.path.join(os.path.dirname(HERE), 'scripts', 'axiomcode'); DL = os.path.join(HERE, 'dl', 'reach.dl')
skipv = {sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a in ('--n', '--seed')}
args = [a for a in sys.argv[1:] if not a.startswith('--') and a not in skipv]; repo = os.path.abspath(args[0]); methods = args[1:]
N = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 30
SEED = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 1
TRUTH = '--truth' in sys.argv
os.chdir(repo); con = sqlite3.connect('.axiomcode/out/graph.sqlite'); con.row_factory = sqlite3.Row
q = lambda s, *p: con.execute(s, p).fetchall()
has = lambda t: bool(q("SELECT 1 FROM sqlite_master WHERE name=?", t))
# a file's top-level code is a callable node too (kind 'module'); the skill counts it among what can reach a method
sym = {r['id']: r for r in q("SELECT id, method_id, display, file, line, end_line, kind, owner, is_test FROM symbols WHERE method_id IS NOT NULL")}
# a Java call written in a field initializer has the TYPE as its caller: a node in the closure that is not a method
for r in q("SELECT id, method_id, display, file, line, end_line, kind, owner, is_test FROM symbols WHERE type_id IS NOT NULL AND method_id IS NULL AND id IN (SELECT caller_id FROM call_edges)"): sym[r['id']] = r

# ── facts, the same selections the skill makes ───────────────────────────────────────────────────────────────
F = tempfile.mkdtemp(prefix='axdl-'); O = tempfile.mkdtemp(prefix='axdl-out-')
def fact(name, rows):
    with open(os.path.join(F, name + '.facts'), 'w') as f:
        for r in rows: f.write('\t'.join(str(x) for x in r) + '\n')
fact('edge', [(r['caller_id'], r['callee_method_id']) for r in q("SELECT caller_id, callee_method_id FROM call_edges WHERE callee_method_id IS NOT NULL AND callee_provenance='client'")])
enc = []; byfile = collections.defaultdict(list)
for r in sym.values():
    if r['kind'] != 'module' and r['line'] is not None and r['end_line'] is not None: byfile[r['file']].append((r['line'], -r['end_line'], r['method_id']))
for f, rows in byfile.items():
    rows.sort(); st = []
    for ln, neg, mid in rows:
        while st and st[-1][1] < -neg: st.pop()
        if st and st[-1][0] <= ln and st[-1][1] >= -neg and st[-1][2] != mid: enc.append((mid, st[-1][2]))
        st.append((ln, -neg, mid))
fact('encl', enc)
fact('disp', [(r[0], r[1]) for r in q("""SELECT DISTINCT dc.base_method_id, dc.candidate_method_id FROM dispatch_candidates dc JOIN methods m ON m.id = dc.candidate_method_id
    WHERE m.provenance='client' AND dc.base_method_id <> dc.candidate_method_id
    AND (m.owner_type_id IS NULL OR m.owner_type_id IN (SELECT type_id FROM type_instantiated) OR NOT EXISTS (SELECT 1 FROM type_instantiated))""")] if has('dispatch_candidates') else [])
refl = []
if has('refs'):
    for r in q("SELECT DISTINCT file, line FROM refs WHERE name IN ('getattr','getDeclaredMethod','getMethod')"):
        x = q("SELECT method_id, owner FROM symbols WHERE file=? AND line<=? AND end_line>=? AND method_id IS NOT NULL AND kind<>'module' ORDER BY (end_line-line) LIMIT 1", r['file'], r['line'], r['line'])
        if not x or not x[0]['owner']: continue
        for m in q("SELECT s.method_id FROM symbols s WHERE s.owner=? AND s.file=? AND s.method_id IS NOT NULL AND s.method_id<>? AND NOT EXISTS (SELECT 1 FROM call_edges e WHERE e.callee_method_id=s.method_id)", x[0]['owner'], r['file'], x[0]['method_id']):
            refl.append((x[0]['method_id'], m['method_id']))
fact('refl', refl)
fact('test', [(m,) for m, r in sym.items() if r['is_test']])
fact('file', [(m, r['file']) for m, r in sym.items()])
tfile = {r['type_id']: r['file'] for r in q("SELECT type_id, file FROM symbols WHERE type_id IS NOT NULL AND is_test = 1")}
fact('tinh', [(tfile[r['type_id']], tfile[r['ancestor_type_id']]) for r in q("SELECT type_id, ancestor_type_id FROM type_ancestors") if r['type_id'] in tfile and r['ancestor_type_id'] in tfile and tfile[r['type_id']] != tfile[r['ancestor_type_id']]] if has('type_ancestors') else [])
fact('byname', [(r['caller_id'], r['callee_name']) for r in q("SELECT DISTINCT s.caller_id, s.callee_name FROM call_sites s JOIN unresolved_sites u ON u.call_site_id=s.id WHERE s.callee_name IS NOT NULL AND s.callee_name<>''")])
fact('named', [(r['name'], r['method_id']) for r in q("SELECT name, method_id FROM symbols WHERE method_id IS NOT NULL AND kind<>'module' AND name IS NOT NULL")])

# ── the queries: named methods, or a seeded sample of non-test methods that have at least one caller ───────────
truth = None
if TRUTH and os.path.exists('.axiomcode/mutation.json'):                       # the mutated methods are the queries
    truth = {x['method']: set(x['truth']) for x in json.load(open('.axiomcode/mutation.json')) if x.get('truth')}
    methods = methods or sorted(truth)
if not methods:
    # unique display names only: `impact` refuses an ambiguous one (seven arrows all named TypeMethodExtractor.traverse)
    cnt = collections.Counter(r['display'] for r in sym.values())
    random.seed(SEED); pool = [m for m, r in sym.items() if not r['is_test'] and r['kind'] != 'module' and cnt[r['display']] == 1 and q("SELECT 1 FROM call_edges WHERE callee_method_id=? LIMIT 1", m)]
    methods = [sym[m]['display'] for m in random.sample(pool, min(N, len(pool)))]
# the skill resolves the name (two `ValueItems.for_element`s: v1 and _internal — it picks one); start from THAT node,
# read off the header `impact of changing X   file:line-end`, so both sides ask about the same declaration
byloc = {(r['file'], r['line']): m for m, r in sym.items() if r['method_id']}
Q = {}; SK = {}
for d in methods:
    o = subprocess.run([AX, 'impact', d, 'limit=100000'], capture_output=True, text=True).stdout
    ot = subprocess.run([AX, 'impact', d, 'limit=100000', 'tests=all'], capture_output=True, text=True).stdout
    # an overloaded name prints one block per declaration: keep the first block only, the one the header names
    cut = lambda t: t[:[mm.start() for mm in re.finditer(r'^impact of changing ', t, re.M)][1]] if len(re.findall(r'^impact of changing ', t, re.M)) > 1 else t
    o, ot = cut(o), cut(ot)
    h = re.search(r'^impact of changing .*?\s(\S+?):(\d+)(?:-\d+)?(?:\s|$)', o, re.M)     # Java adds the signature before the location
    if h and (h.group(1), int(h.group(2))) in byloc: Q[d] = byloc[(h.group(1), int(h.group(2)))]; SK[d] = (o, ot)
# the skill starts the closure from the method AND its dispatch siblings (overrides / implementations, the MAY set)
disp_rows = q("SELECT DISTINCT base_method_id b, candidate_method_id k FROM dispatch_candidates") if has('dispatch_candidates') else []
sibs = collections.defaultdict(set)
for r in disp_rows: sibs[r['b']].add(r['k']); sibs[r['k']].add(r['b'])
if has('overrides'):
    for r in q("SELECT * FROM overrides"):
        a, b = r[0], r[1]; sibs[a].add(b); sibs[b].add(a)
starts = [(d, m) for d, m in Q.items()] + [(d, s_) for d, m in Q.items() for s_ in sibs.get(m, ()) if s_ in sym]
fact('start', starts)
START = collections.defaultdict(set)
for d, m in starts: START[d].add(m)
r = subprocess.run(['souffle', '-F', F, '-D', O, DL], capture_output=True, text=True)
if r.returncode: print(r.stderr); sys.exit(1)
def load(name):
    out = collections.defaultdict(list)
    for l in open(os.path.join(O, name + '.csv')):
        p = l.rstrip('\n').split('\t'); out[p[0]].append(p[1:])
    return out
HOPS, TR, TF, TO, BR = load('hops'), load('tests_reach'), load('tests_file'), load('tests_opt'), load('bridge')

# ── 1. CHECK against the skill ─────────────────────────────────────────────────────────────────────────────────
agree = 0; rows = []; rec_sound = []; rec_opt = []; prec_sound = []; prec_opt = []
for d in methods:
    if d not in Q: print(f"  {d}: not a method in this graph"); continue
    o, ot = SK[d]                                  # two calls: the 12k-char cap truncates `tests=all` before the TRANSITIVE line
    m = re.search(r'TRANSITIVE — everything that can reach it: (\d+) methods in (\d+) files(?: \(by hop (.*?)\))?', o)
    sk_n = int(m.group(1)) if m else 0
    sk_hops = dict((int(a), int(b)) for a, b in re.findall(r'(\d+):(\d+)', m.group(3))) if m and m.group(3) else {}
    sk_tests_truncated = '… truncated' in ot
    sk_tests = set(re.findall(r'^    TEST (\S+)   ', ot, re.M))            # a cut-off last line has no grade after the name
    # the skill's TRANSITIVE is the non-test methods other than the one asked about; tests are the VERIFY set
    prod = [x for x in HOPS[d] if x[0] in sym and not sym[x[0]]['is_test'] and x[0] not in START[d]]
    dl_n = len(prod); dl_hops = collections.Counter(int(x[1]) for x in prod); dl_tests = {x[0] for x in TF[d]}
    opt_tests = {sym[x[0]]['file'] for x in TO[d] if x[0] in sym}
    ok = sk_n == dl_n and (sk_tests == dl_tests or (sk_tests_truncated and sk_tests <= dl_tests))
    agree += ok
    line = f"  {'OK ' if ok else 'DIFF'} {d:55} transitive skill {sk_n:4} / datalog {dl_n:4}   tests files skill {len(sk_tests):3} / datalog {len(dl_tests):3}   by-name bound adds {len(opt_tests):3} test file(s)"
    if not ok:
        line += f"\n        hops skill {dict(sorted(sk_hops.items()))} datalog {dict(sorted(dl_hops.items()))}"
        if sk_tests ^ dl_tests: line += f"\n        only skill: {sorted(sk_tests - dl_tests)[:4]}  only datalog: {sorted(dl_tests - sk_tests)[:4]}" + ("  (skill list truncated)" if sk_tests_truncated else '')
    if truth and d in truth:
        t = truth[d]; s_hit = len(dl_tests & t); o_all = dl_tests | opt_tests; o_hit = len(o_all & t)
        rec_sound.append(s_hit / len(t)); rec_opt.append(o_hit / len(t))
        if dl_tests: prec_sound.append(s_hit / len(dl_tests))
        if o_all: prec_opt.append(o_hit / len(o_all))
        rec = sorted((opt_tests & t) - dl_tests)
        line += f"\n        truth {len(t)} files: sound hits {s_hit}, by-name bound hits {o_hit}" + (f" — recovered {rec[:3]}" if rec else '')
        for x in rec[:2]:
            for b in BR[d][:200]:
                if b[0] in sym and sym[b[0]]['file'] == x or any(sym.get(b[0], {}) and sym[b[0]]['file'] == x for _ in [0]):
                    line += f"\n          via unresolved `{b[1]}` in {sym[b[0]]['display']} ({sym[b[0]]['file']})"; break
    rows.append(line)
print('\n'.join(rows))
print(f"\n{agree}/{len([m for m in methods if m in Q])} queries: the skill's closure and the Datalog closure agree exactly")
if truth and rec_sound:
    print(f"against mutation truth (n={len(rec_sound)}): file recall sound {sum(rec_sound)/len(rec_sound):.2f} → by-name bound {sum(rec_opt)/len(rec_opt):.2f};  precision sound {sum(prec_sound)/max(1,len(prec_sound)):.2f} → by-name bound {sum(prec_opt)/max(1,len(prec_opt)):.2f}")
