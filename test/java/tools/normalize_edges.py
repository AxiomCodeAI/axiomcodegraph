#!/usr/bin/env python3
"""Normalize <out>/call-chain-edges.csv into a stable, reviewable golden form.

One line per edge:    <status>\t<kind>\tCaller#name(params) -> Callee#name(params)
sorted, deduplicated. Hashes are resolved to names so a golden file is human-reviewable and is
NOT sensitive to hash churn.

CONVENTIONS (deliberate, not defects):
  * NESTED TYPES ARE FLATTENED. `package p; class A { class B {} }` yields owners `p.A` and `p.B`,
    not `p.A.B`. This mirrors the IR and is accepted behaviour.
  * ANONYMOUS classes are keyed by their SUPERTYPE (`Outer$anon:Runnable`), because javac and the
    engine number anonymous classes differently — numbering would make goldens brittle.
  * TYPE VARIABLES are erased to their bound (default Object), so `add(E)` reads `add(Object)`.
  * Library callees keep their fully-qualified owner; unresolved sites are emitted with target `-`
    so a golden records *declared unknowns* too (a silently dropped site can never look "expected").

usage: normalize_edges.py <IR-dir> <OUT-dir> [<jdk-method-index.tsv>]
"""
import csv, os, re, sys

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
    def __init__(self, ir, jdk_index=None):
        self.m = {}
        tvars, mtvars = set(), set()
        for r in rows(f'{ir}/all-type-parameters.csv'):
            tvars.add((r.get('typeRegistryLinkHash', ''), r.get('paramName', '')))
        for r in rows(f'{ir}/all-method-type-parameters.csv'):
            mtvars.add((r.get('methodRegistryLinkHash', ''), r.get('paramName') or r.get('name', '')))
        params = {}
        for p in rows(f'{ir}/all-method-parameters.csv'):
            params.setdefault(p['methodRegistryLinkHash'], []).append(p)
        # anonymous classes -> Outer$anon:<Supertype>
        sup = {}
        for r in rows(f'{ir}/all-type-references.csv'):
            if r.get('context') == 'SUPER_TYPE' and (r.get('depth') or '0') == '0':
                sup.setdefault(r.get('typeRegistryLinkHash'), r.get('typeName'))
        self.anon = {}
        for t in rows(f'{ir}/all-types.csv'):
            if t.get('typePlacement') == 'ANONYMOUS_PLACEMENT':
                qn = t['qualifiedName']; pkg = qn[:qn.rindex('.')] if '.' in qn else ''
                outer = qn.split('$')[0].split('.')[-1]
                self.anon[qn] = f"{(pkg + '.') if pkg else ''}{outer}$anon:{simple(sup.get(t['typeRegistryUniqueHash'], '?'))}"
        for r in rows(f'{ir}/all-methods.csv'):
            h, th = r['methodRegistryUniqueHash'], r.get('typeRegistryLinkHash', '')
            ps = []
            for p in sorted(params.get(h, []), key=lambda x: int(x.get('position') or 0)):
                if p.get('isReceiverParameter') == 'true': continue
                t = simple(p.get('parameterTypeName') or p.get('parameterBaseType'))
                b, suf = (t[:-2], '[]') if t.endswith('[]') else (t, '')
                if (th, b) in tvars or (h, b) in mtvars or re.fullmatch(r'[A-Z]\d?', b): b = 'Object'
                if p.get('isVarArgs') == 'true' and not suf: suf = '[]'
                ps.append(b + suf)
            cls = r.get('ownerQualifiedName') or r.get('ownerTypeName')
            nm = '<init>' if r.get('methodKind') == 'CONSTRUCTOR' else r.get('name')
            self.m[h] = f"{self.anon.get(cls, cls)}#{nm}({','.join(ps)})"
        self.types = {t['typeRegistryUniqueHash']: t['qualifiedName'] for t in rows(f'{ir}/all-types.csv')}
        self.jdk = {}
        if jdk_index and os.path.exists(jdk_index):
            for line in open(jdk_index, encoding='utf-8', errors='replace'):
                p = line.rstrip('\n').split('\t')
                if len(p) >= 3:
                    nm = p[2].split('(')[0]
                    if nm == p[1].split('.')[-1]: nm = '<init>'
                    args = p[2][p[2].index('(') + 1:p[2].rindex(')')] if '(' in p[2] else ''
                    ps = [simple(x) for x in args.split(',') if x.strip()]
                    ps = ['Object' if re.fullmatch(r'[A-Z]\d?', x) else x for x in ps]
                    if len(p) > 5 and p[5] == 'true' and ps and not ps[-1].endswith('[]'):
                        ps[-1] += '[]'
                    self.jdk[p[0]] = f"{p[1]}#{nm}({','.join(ps)})"

    def label(self, h):
        if h in ('-', ''): return '-'
        if h in self.m: return self.m[h]
        if h in self.jdk: return self.jdk[h]
        if h in self.types: return f"{self.types[h]}#<type-initializer>()"
        return f"<unresolved:{h[:24]}>"

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    client_only = '--client-pairs' in sys.argv     # for the bytecode-oracle comparison
    ir, out = args[0], args[1]
    jdk = args[2] if len(args) > 2 else None
    n = Names(ir, jdk)
    seen = set()
    for line in open(f'{out}/call-chain-edges.csv', encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 7: continue
        if client_only:
            # client -> client only: both ends must be methods declared in THIS project
            if f[1] not in n.m or f[3] not in n.m: continue
            seen.add(f"{n.label(f[1])} -> {n.label(f[3])}")
        else:
            seen.add(f"{f[5]}\t{f[6]}\t{n.label(f[1])} -> {n.label(f[3])}")
    for s in sorted(seen): print(s)

if __name__ == '__main__':
    main()
