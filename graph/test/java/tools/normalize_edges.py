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
  * CLIENT -> CLIENT ONLY by default. No library IR is staged for most cases, so a call into a
    library resolves to nothing and is emitted with target `-` as ambiguous_unknown. Declared
    unknowns are part of the golden (a silently dropped site can never look "expected").
  * A case that ships a STUB LIBRARY passes its IR as a third argument, and library callees are
    then named the same way client ones are. Without it a boundary edge reads as an opaque
    <unresolved:HASH>, which makes the golden churn on every parser change that moves a hash —
    the exact brittleness the name resolution above exists to prevent.

usage: normalize_edges.py <IR-dir> <OUT-dir> [<LIB-IR-dir>]
"""
import csv, os, re, sys
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh

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
    def __init__(self, ir):
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
            nm = '<init>' if r.get('methodKind') in ('CONSTRUCTOR', 'DEFAULT_CONSTRUCTOR') else r.get('name')
            self.m[h] = f"{self.anon.get(cls, cls)}#{nm}({','.join(ps)})"
        self.types = {t['typeRegistryUniqueHash']: t['qualifiedName'] for t in rows(f'{ir}/all-types.csv')}

    def label(self, h):
        if h in ('-', ''): return '-'
        if h in self.m: return self.m[h]
        if h in self.types: return f"{self.types[h]}#<type-initializer>()"
        # An EXTERNAL target is a label, not a hash: `external:<type>.<name>`, the method of an
        # ancestor no staged IR declares (resolution/external-types.dl). Printed whole — it is
        # already a readable name, and truncating it would hide which type the call left for.
        if h.startswith('external:'): return h
        return f"<unresolved:{h[:24]}>"

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    client_only = '--client-pairs' in sys.argv     # for the bytecode-oracle comparison
    ir, out = args[0], args[1]
    n = Names(ir)
    # A stub library's methods are named from its own IR, so a boundary edge is readable and the
    # golden does not move when a hash does.
    # A ROOT OF ROOTS is accepted as well as a single IR — the platform library is staged as one
    # directory per module, and a run that stages it would otherwise leave every JDK callee as a
    # raw METHOD_REGISTRY hash in the golden. That breaks the promise one line above: the hashes
    # move whenever the platform IR is rebuilt, so the golden churns for a reason that has nothing
    # to do with the engine.
    # REFUSE a library root that is not a directory, rather than ignoring it. Accepting the
    # argument and silently continuing made a mistyped, moved or word-split root indistinguishable
    # from "no library root was passed", and the only evidence was a golden diff two steps later
    # that pointed at method resolution.
    if len(args) > 3:
        sys.exit(f"normalize_edges: too many arguments: {args[3:]!r}\n"
                 "  usage: normalize_edges.py <ir> <out> [lib-ir] [--client-pairs]\n"
                 "  a path containing a space, unquoted by the caller, arrives split — check the invocation")
    if len(args) > 2 and not os.path.isdir(args[2]):
        sys.exit(f"normalize_edges: library root is not a directory: {args[2]!r}\n"
                 "  a path containing a space, unquoted by the caller, arrives split — check the invocation")
    if len(args) > 2 and os.path.isdir(args[2]):
        roots = [args[2]] if os.path.exists(os.path.join(args[2], 'all-methods.csv')) else \
                [os.path.join(args[2], d) for d in sorted(os.listdir(args[2]))
                 if os.path.exists(os.path.join(args[2], d, 'all-methods.csv'))]
        for root in roots:
            lib = Names(root)
            for h, label in lib.m.items():
                n.m.setdefault(h, label)
            for h, qn in lib.types.items():
                n.types.setdefault(h, qn)
    seen = set()
    for line in open(f'{out}/call-chain-edges.csv', encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 7: continue
        if client_only:
            # client -> client only: both ends must be declared in THIS project. A caller keyed by
            # a TYPE rather than a method is a call written in a FIELD INITIALIZER, which javac
            # compiles into the constructor — so bytecode attributes it to `<init>` and the two
            # sides can be compared. Dropping those rows made every such call invisible to the
            # oracle in both directions, which is the same blind spot #162 found in the boundary
            # scorer. A STATIC initializer compiles into `<clinit>`, which the oracle excludes, so
            # it is left out here too.
            caller = n.m.get(f[1]) or (f"{n.types[f[1]]}#<init>()" if f[1] in n.types else None)
            if caller is None or f[3] not in n.m: continue
            seen.add(f"{caller} -> {n.label(f[3])}")
        else:
            seen.add(f"{f[5]}\t{f[6]}\t{n.label(f[1])} -> {n.label(f[3])}")
    for s in sorted(seen): print(s)

if __name__ == '__main__':
    main()
