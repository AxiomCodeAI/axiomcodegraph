#!/usr/bin/env python3
"""Score the engine's client->client edges against the JDK ClassFile-API oracle, at corpus scale.

Reports, per SCORING.md §4 and §7:
  * conservation (silent drops) — read from the coverage guard, separately
  * P, recall vs CERTAIN (G_lb), recall vs POSSIBLE (G_ub), F1, MCC
  * every FP split into SOUND (inside G_ub) vs FABRICATED (outside it) — the number that matters
  * the missing-edge census, grouped so a mechanism is visible instead of a list

Both sides are restricted to the same caller scope, and the scope is printed, because an exclusion
nobody can see is one nobody can check.

usage: score_scale.py <IR> <OUT> <oracle-lb> <oracle-ub> [--scope-prefix p1,p2] [--census N]
"""
import csv, os, re, sys, collections, math

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

def rows(path):
    if not os.path.exists(path): return []
    with open(path, newline='', encoding='utf-8', errors='replace') as f:
        r = list(csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE))
    if not r: return []
    hdr = r[0]
    return [dict(zip(hdr, x + [''] * (len(hdr) - len(x)))) for x in r[1:]]

def simple(t):
    t = (t or '').strip(); arr = ''
    while t.endswith('[]'): arr += '[]'; t = t[:-2]
    if t.endswith('...'): arr += '[]'; t = t[:-3]
    out, d = [], 0
    for ch in t:
        if ch == '<': d += 1
        elif ch == '>': d -= 1
        elif d == 0: out.append(ch)
    t = ''.join(out)
    while t.endswith('[]'): arr += '[]'; t = t[:-2]
    return t.split('.')[-1].split('$')[-1] + arr

class Names:
    """Identical conventions to test/java/tools/normalize_edges.py — one normalisation, both sides."""
    def __init__(self, ir):
        self.m, self.file = {}, {}
        tvars, mtvars = set(), set()
        for r in rows(f'{ir}/all-type-parameters.csv'):
            tvars.add((r.get('typeRegistryLinkHash',''), r.get('paramName','')))
        for r in rows(f'{ir}/all-method-type-parameters.csv'):
            mtvars.add((r.get('methodRegistryLinkHash',''), r.get('paramName') or r.get('name','')))
        params = {}
        for p in rows(f'{ir}/all-method-parameters.csv'):
            params.setdefault(p['methodRegistryLinkHash'], []).append(p)
        sup = {}
        for r in rows(f'{ir}/all-type-references.csv'):
            if r.get('context') == 'SUPER_TYPE' and (r.get('depth') or '0') == '0':
                sup.setdefault(r.get('typeRegistryLinkHash'), r.get('typeName'))
        self.anon, tfile = {}, {}
        for t in rows(f'{ir}/all-types.csv'):
            tfile[t['typeRegistryUniqueHash']] = t.get('filePath','')
            if t.get('typePlacement') == 'ANONYMOUS_PLACEMENT':
                qn = t['qualifiedName']; pkg = qn[:qn.rindex('.')] if '.' in qn else ''
                outer = qn.split('$')[0].split('.')[-1]
                self.anon[qn] = f"{(pkg + '.') if pkg else ''}{outer}$anon:{simple(sup.get(t['typeRegistryUniqueHash'],'?'))}"
        for r in rows(f'{ir}/all-methods.csv'):
            h, th = r['methodRegistryUniqueHash'], r.get('typeRegistryLinkHash','')
            ps = []
            for p in sorted(params.get(h, []), key=lambda x: int(x.get('position') or 0)):
                if p.get('isReceiverParameter') == 'true': continue
                t = simple(p.get('parameterTypeName') or p.get('parameterBaseType'))
                b, suf = (t[:-2], '[]') if t.endswith('[]') else (t, '')
                if (th, b) in tvars or (h, b) in mtvars or re.fullmatch(r'[A-Z]\d?', b): b = 'Object'
                if p.get('isVarArgs') == 'true' and not suf: suf = '[]'
                ps.append(b + suf)
            cls = r.get('ownerQualifiedName') or r.get('ownerTypeName')
            nm = '<init>' if r.get('methodKind') in ('CONSTRUCTOR', 'DEFAULT_CONSTRUCTOR') else r.get('name')
            self.m[h] = f"{self.anon.get(cls, cls)}#{nm}({','.join(ps)})"
            self.file[h] = r.get('filePath') or tfile.get(th, '')

TESTPATH = re.compile(r'(^|/)(test|tests|testsuite|test-framework|testFixtures|it|e2e|benchmarks|examples|fixtures)(/|$)'
                      r'|[^/]*(Test|Tests|IT|TestCase)\.java$|(^|/)Test[A-Z][^/]*\.java$')

def caller_name(e):        # oracle_diff compares callers at NAME level (a lambda body carries no descriptor)
    a, b = e.split(' -> ', 1)
    return re.sub(r'\([^)]*\)$', '', a) + ' -> ' + b

def main():
    ir, out, lb_f, ub_f = sys.argv[1:5]
    scope = []
    if '--scope-prefix' in sys.argv:
        scope = sys.argv[sys.argv.index('--scope-prefix') + 1].split(',')
    census_n = int(sys.argv[sys.argv.index('--census') + 1]) if '--census' in sys.argv else 25
    # The oracle only sees the artifacts you compiled. An engine edge whose CALLEE lives in a
    # module that was not compiled is outside G_ub by construction, not by inference — scoping one
    # side and not the other manufactures false positives. Scope both ends by the same class set.
    app_classes = None
    if '--app-classes' in sys.argv:
        app_classes = {l.strip() for l in open(sys.argv[sys.argv.index('--app-classes') + 1]) if l.strip()}

    n = Names(ir)
    in_scope_hash, excluded_test = set(), 0
    for h, lbl in n.m.items():
        fp = n.file.get(h, '')
        if TESTPATH.search(fp): excluded_test += 1; continue
        if scope and not any(s in fp for s in scope): continue
        in_scope_hash.add(h)

    eng = set()
    for line in open(f'{out}/call-chain-edges.csv', encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 7: continue
        if f[1] not in n.m or f[3] not in n.m: continue         # client -> client only
        if f[1] not in in_scope_hash: continue                  # caller must be in scope
        if '#<init>(' in n.m[f[3]]: continue                    # ctor targets excluded on BOTH sides
        if '#<clinit>(' in n.m[f[1]]: continue                  # static initialisers: excluded on BOTH sides
        if app_classes is not None and (n.m[f[1]].split('#')[0] not in app_classes
                                        or n.m[f[3]].split('#')[0] not in app_classes): continue
        eng.add(caller_name(f"{n.m[f[1]]} -> {n.m[f[3]]}"))

    def load(p):
        s = set()
        for l in open(p):
            l = l.strip()
            if ' -> ' not in l: continue
            s.add(caller_name(l))
        return s
    lb, ub = load(lb_f), load(ub_f)
    # the oracle sees compiled classes for the whole artifact; restrict it to the same caller scope
    scoped_callers = {n.m[h].split('#')[0] for h in in_scope_hash}
    def in_scope(e): return e.split('#')[0] in scoped_callers
    lb = {e for e in lb if in_scope(e)}; ub = {e for e in ub if in_scope(e)} | lb

    TP = len(eng & lb); FP = len(eng - lb); FN = len(lb - eng)
    N  = len(scoped_callers) ** 2 if scoped_callers else 1
    TN = max(N - TP - FP - FN, 0)
    P  = TP / (TP + FP) if TP + FP else 0.0
    Rc = TP / (TP + FN) if TP + FN else 0.0
    Rp = len(eng & ub) / len(ub) if ub else 0.0
    F1 = 2 * P * Rc / (P + Rc) if P + Rc else 0.0
    den = math.sqrt((TP+FP)*(TP+FN)*(TN+FP)*(TN+FN)) or 1
    MCC = (TP*TN - FP*FN) / den
    sound = len((eng - lb) & ub); fabricated = len(eng - ub)

    print(f"scoped by compiled app classes: {len(app_classes) if app_classes else 'n/a'}")
    print(f"scope: {len(in_scope_hash)} methods in {len(scoped_callers)} types"
          f"   (test-path methods excluded: {excluded_test})")
    print(f"edges  engine={len(eng)}  certain(G_lb)={len(lb)}  possible(G_ub)={len(ub)}")
    print(f"  precision            {P:.3f}")
    print(f"  recall vs certain    {Rc:.3f}   ({TP}/{TP+FN})")
    print(f"  recall vs possible   {Rp:.3f}   ({len(eng & ub)}/{len(ub)})")
    print(f"  F1 {F1:.3f}   MCC {MCC:.3f}")
    print(f"  FP split: SOUND(in G_ub) {sound}   FABRICATED(outside G_ub) {fabricated}")

    missing = sorted(lb - eng)
    print(f"\nMISSING-EDGE CENSUS  ({len(missing)} edges)")
    by_callee_type = collections.Counter(e.split(' -> ')[1].split('#')[0] for e in missing)
    for t, c in by_callee_type.most_common(census_n):
        print(f"  {c:6d}  callee type {t}")
    with open('/tmp/qa-missing.txt', 'w') as f:
        for e in missing: f.write(e + '\n')
    with open('/tmp/qa-fabricated.txt', 'w') as f:
        for e in sorted(eng - ub): f.write(e + '\n')
    print("  (full list: /tmp/qa-missing.txt, fabricated: /tmp/qa-fabricated.txt)")

if __name__ == '__main__':
    main()
