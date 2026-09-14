#!/usr/bin/env python3
"""Resolve library method hashes from the engine's output back to canonical names.

A library IR root is 2 GB and holds one module per sub-folder, so it is never loaded whole:
the caller passes the hashes it actually saw and only those rows are kept. Names follow the
same conventions as score_scale.Names — one normalisation, both sides of every comparison.
"""
import csv, os, sys
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_scale import simple

def _rows(path):
    if not os.path.exists(path): return
    with open(path, newline='', encoding='utf-8', errors='replace') as f:
        r = csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE)
        try: hdr = next(r)
        except StopIteration: return
        n = len(hdr)
        for x in r:
            if len(x) >= n: yield dict(zip(hdr, x))

def resolve(roots, want):
    """roots: library IR roots (each holding module folders, or being one module).
    want: set of methodRegistryUniqueHash. -> {hash: 'pkg.Type#name(P1,P2)'}"""
    want = set(want); out = {}
    mods = []
    for root in roots:
        if os.path.exists(os.path.join(root, 'all-types.csv')): mods.append(root); continue
        for d in sorted(os.listdir(root)):
            p = os.path.join(root, d)
            if os.path.isdir(p) and os.path.exists(os.path.join(p, 'all-types.csv')): mods.append(p)
    for m in mods:
        if not want: break
        hit = {}
        for r in _rows(f'{m}/all-methods.csv'):
            h = r['methodRegistryUniqueHash']
            if h in want: hit[h] = r
        if not hit: continue
        # type variables erase to Object, exactly as on the client side
        tvars, mtvars = set(), set()
        for r in _rows(f'{m}/all-type-parameters.csv'):
            tvars.add((r.get('typeRegistryLinkHash',''), r.get('paramName','')))
        for r in _rows(f'{m}/all-method-type-parameters.csv'):
            mtvars.add((r.get('methodRegistryLinkHash',''), r.get('paramName') or r.get('name','')))
        params = {}
        for p in _rows(f'{m}/all-method-parameters.csv'):
            if p['methodRegistryLinkHash'] in hit:
                params.setdefault(p['methodRegistryLinkHash'], []).append(p)
        import re
        for h, r in hit.items():
            th = r.get('typeRegistryLinkHash','')
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
            out[h] = f"{cls}#{nm}({','.join(ps)})"
            out.setdefault('__module__:' + h, os.path.basename(m))
        want -= set(hit)
    return out

if __name__ == '__main__':
    roots = sys.argv[1].split(',')
    hashes = {l.strip() for l in sys.stdin if l.strip()}
    r = resolve(roots, hashes)
    for h in sorted(hashes):
        print(f"{h}\t{r.get(h,'(UNRESOLVED)')}\t{r.get('__module__:'+h,'-')}")
