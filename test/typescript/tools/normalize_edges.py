#!/usr/bin/env python3
"""Normalize <out>/call-chain-edges.csv into a stable, reviewable golden form.

One line per edge:   <status>\t<kind>\tCaller @L<line> -> Callee
sorted and deduplicated.

THE CALL SITE'S LINE IS PART OF THE KEY, and that is not cosmetic. Deduplicating on
(caller, target) alone merges every call to an overloaded function from one caller into
a single row, so three calls that all resolved to the WRONG first overload look
identical to one call that resolved correctly. Measured on 04-overload-selection: three
`format(...)` sites collapsed to one golden line and hid a two-argument call resolving
to a one-parameter signature. The line number costs a little churn when a fixture is
edited and buys the ability to see that. Hashes are resolved to names, so a golden is readable and is
NOT sensitive to hash churn.

LABELS
  A method is `<owner>#<name>(<paramTypes>)`. The owner is the declaring type when
  there is one and the MODULE otherwise, because a top-level TypeScript function has
  no owning type — which is the single biggest shape difference from the Java golden.

CONVENTIONS (deliberate, not defects)
  * Type parameters are erased to `T`, so `get(): T` and `map<U>` do not make the
    golden depend on inference the engine is not claiming to do.
  * An arrow function bound to a const is labelled by the CONST's name where the
    parser records one, and `<arrow@line>` otherwise. Arrows are ~13% of callable
    declarations in real TypeScript and unlabelled ones make a golden unreadable.
  * A label that is ambiguous — two declarations sharing owner, name and parameter
    types, which is exactly what an overload set looks like when the parameters
    erase to the same string — gets `@L<line>` appended. Overload cases would
    otherwise collapse into one line and the golden could not tell them apart.
  * CLIENT -> CLIENT ONLY. This suite stages no library IR, so a call into a library
    resolves to nothing and is emitted with target `-`. Those rows stay IN the golden:
    a declared unknown is an answer, and a silently dropped site must never be able to
    look like one.

  * A LIBRARY target is labelled from the library's OWN IR, keyed relative to the
    library root — the same label a separately parsed dependency produces. Without
    `--lib-ir` those targets read `<unresolved:...>`, which is exactly what a
    client-only run should show and exactly what a with-library run must not.

usage: normalize_edges.py <IR-dir> <OUT-dir> [--lib-ir <dir>] [--client-pairs]
"""
import csv, os, re, sys
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
from collections import defaultdict


def rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8', errors='replace') as f:
        r = list(csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE))
    if not r:
        return []
    hdr = r[0]
    return [dict(zip(hdr, x + [''] * (len(hdr) - len(x)))) for x in r[1:]
            if len(x) >= len(hdr) - 2]


def simple(t):
    """`Promise<Row>[]` -> `Promise[]`; `a.b.C` -> `C`; a type variable -> `T`."""
    t = (t or '').strip()
    arr = ''
    while t.endswith('[]'):
        arr += '[]'
        t = t[:-2]
    out, d = [], 0
    for ch in t:
        if ch == '<':
            d += 1
        elif ch == '>':
            d -= 1
        elif d == 0:
            out.append(ch)
    t = ''.join(out).strip()
    while t.endswith('[]'):
        arr += '[]'
        t = t[:-2]
    t = t.split('.')[-1]
    if re.fullmatch(r'[A-Z]\d?', t):        # T, U, T1 — a type variable
        t = 'T'
    return (t or '?') + arr


class Names:
    def __init__(self, ir, lib_ir=None):
        mods = {m['tsModuleUniqueHash']: m['qualifiedName'] or m['filePath']
                for m in rows(f'{ir}/all-typescript-modules.csv')}
        params = defaultdict(list)
        for p in rows(f'{ir}/all-typescript-method-parameters.csv'):
            params[p['tsMethodLinkHash']].append(p)
        # A variable whose initializer IS a function expression names that function.
        arrow_name = {}
        for v in rows(f'{ir}/all-typescript-variables.csv'):
            h = v.get('tsMethodLinkHash') or ''
            if h and v.get('name'):
                arrow_name.setdefault(h, v['name'])

        self.m, self.mods = {}, mods
        raw = {}
        for r in rows(f'{ir}/all-typescript-methods.csv'):
            h = r['tsMethodUniqueHash']
            ps = []
            for p in sorted(params.get(h, []), key=lambda x: int(x.get('position') or 0)):
                if p.get('isReceiverParameter') == 'true':
                    continue
                t = simple(p.get('parameterTypeName') or p.get('parameterBaseType'))
                if p.get('isVarArgs') == 'true' and not t.endswith('[]'):
                    t += '[]'
                ps.append(t)
            owner = r.get('ownerTypeName') or mods.get(r.get('tsModuleLinkHash'), '?')
            name = r.get('name') or arrow_name.get(h) or ''
            if not name or name.startswith('<'):
                name = arrow_name.get(h) or f"<arrow@{r.get('startLine')}>"
            kind = r.get('methodKind') or ''
            if kind == 'CONSTRUCTOR':
                name = '<new>'
            elif r.get('isStatic') == 'true':
                name = 'static ' + name
            raw[h] = (f"{owner}#{name}({','.join(ps)})", r.get('startLine') or '0')

        # Disambiguate collisions — an overload set erasing to one string.
        counts = defaultdict(int)
        for label, _ in raw.values():
            counts[label] += 1
        for h, (label, line) in raw.items():
            self.m[h] = f"{label}@L{line}" if counts[label] > 1 else label

        if lib_ir:
            other = Names(lib_ir)
            for h, lbl in other.m.items():
                self.m.setdefault(h, lbl)
            for h, lbl in other.mods.items():
                self.mods.setdefault(h, lbl)

    def label(self, h):
        if h in ('-', ''):
            return '-'
        if h in self.m:
            return self.m[h]
        if h in self.mods:
            return f"{self.mods[h]}#<module-init>()"
        return f"<unresolved:{h[:24]}>"


def main():
    argv = sys.argv[1:]
    pairs_only = '--client-pairs' in argv
    lib_ir = None
    if '--lib-ir' in argv:
        i = argv.index('--lib-ir')
        lib_ir = argv[i + 1]
        del argv[i:i + 2]
    args = [a for a in argv if not a.startswith('--')]
    ir, out = args[0], args[1]
    n = Names(ir, lib_ir)
    site_line = {}
    for r in rows(f'{ir}/all-typescript-call-sites.csv'):
        site_line[r['tsExpressionLinkHash']] = r.get('startLine') or '?' 
    seen = set()
    path = f'{out}/call-chain-edges.csv'
    if not os.path.exists(path):
        sys.exit(f'no {path}')
    for line in open(path, encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 7:
            continue
        if pairs_only:
            if f[1] not in n.m or f[3] not in n.m:
                continue
            seen.add(f"{n.label(f[1])} -> {n.label(f[3])}")
        else:
            ln = site_line.get(f[0], '?')
            seen.add(f"{f[5]}\t{f[6]}\t{n.label(f[1])} @L{ln} -> {n.label(f[3])}")
    for s in sorted(seen):
        print(s)


if __name__ == '__main__':
    main()
