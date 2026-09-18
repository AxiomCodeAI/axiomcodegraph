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
  An ANONYMOUS shape is not a declaring type: a member of `{ run(): string }`, and an
  arrow that is a property's declared type, take the nearest enclosing NAMED declaration
  if there is one and the module if there is not. That is the rule the compiler side
  already uses, and matching it is what stops the same declaration counting twice.

CONVENTIONS (deliberate, not defects)
  * Type parameters are erased to `T`, so `get(): T` and `map<U>` do not make the
    golden depend on inference the engine is not claiming to do.
  * An arrow function bound to a const is labelled by the CONST's name -- read off
    `boundFunctionLinkHash`, NOT `tsMethodLinkHash`, which is the variable's enclosing
    method -- and `<arrow@line>` otherwise. Arrows are ~13% of callable declarations in
    real TypeScript and unlabelled ones make a golden unreadable. A class FIELD holding an
    arrow keeps `<arrow@line>`, because that is what the compiler side calls it.
  * The module initializer is `<module-init>`, the name the compiler side uses, so a
    top-level call is comparable rather than reading as a missing edge.
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
        # rfc4180, MATCHING SOUFFLE. The engine loads these same files with
        # `rfc4180=true`, so a string-literal type reaches a rule as `"close"` while a
        # QUOTE_NONE reader here sees the raw field `"""close"""`. Measured on three
        # projects: 6,193 values across 10 tables differ between the two readings,
        # including parameterTypeName, returnTypeName, ownerTypeName and completeTypeName.
        # Reading them differently on the two sides manufactures label mismatches that
        # look exactly like engine defects.
        r = list(csv.reader(f, delimiter='\t'))
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
        # A variable whose initializer IS a function expression names that function -- and the FK
        # that says so is boundFunctionLinkHash. tsMethodLinkHash is the variable's ENCLOSING
        # method, so keying on it got this wrong in both directions at once: the arrow was never
        # found (so `const step = (x) => ...` rendered `<arrow@1>` while the compiler side said
        # `step`, one MISSING plus one extra per call), and the ENCLOSING scope was named after
        # whichever variable happened to land on it -- a module-level call came out
        # `m#step() -> m#plain(number)`, attributing it to an unrelated arrow. See issue #236.
        #
        # Only variables, deliberately: a CLASS FIELD holding an arrow is `C#<arrow@N>` on the
        # compiler side too, so the two sides already agree there and naming it after the field
        # would break that agreement.
        arrow_name = {}
        for v in rows(f'{ir}/all-typescript-variables.csv'):
            h = v.get('boundFunctionLinkHash') or ''
            if h and v.get('name'):
                arrow_name.setdefault(h, v['name'])

        # ── A SHAPE HAS NO NAME, SO ASK WHAT THE SHAPE IS THE TYPE OF ───────────────
        # `ownerTypeName` is the anonymous type literal's own SOURCE TEXT for a
        # TYPE_LITERAL_* member, and EMPTY for a FUNCTION_TYPE_SIGNATURE. Neither is an
        # owner. The first is unstable — the parser truncates it at 120 characters, and it
        # moves whenever any member of the shape is edited — and unreadable in a golden;
        # the second says nothing at all. The compiler side names the nearest ENCLOSING
        # named declaration (class, interface, enum, namespace) and the module otherwise,
        # so the two sides disagreed in OPPOSITE directions on the SAME declaration at the
        # SAME line: one missing edge PLUS one extra, per call, charged against accuracy
        # the engine had already got right. Same class as #299 and #236. See issue #322.
        #
        # The route back to a real owner is the type reference the shape IS. A method's
        # `tsTypeLinkHash` points at its own `ts_type_reference` row — the parser sets it
        # that way deliberately, because an anonymous shape has no `ts_type` to belong to
        # — and that row records the ENTITY the type was written for.
        #
        # Only a FIELD owner yields a name, and that is not a shortcut:
        #   * FIELD       `run: (n) => string` in `interface Holder` -> `Holder`, which is
        #                 what the compiler side calls it.
        #   * TYPE        a type ALIAS. `type T = { run(): string }` is NOT an owner on the
        #                 compiler side either — an alias is not a class or an interface —
        #                 so falling through to the module is what MATCHES it.
        #   * METHOD_PARAM an inline annotation, `f(p: { run(): string })`. The compiler
        #                 side walks past it to the module too.
        # A field that is ITSELF a type-literal member has the same non-name problem and
        # so cannot supply an owner either — otherwise `{ p: { run(): string } }` would
        # hand back the outer literal's text, trading one unstable owner for another.
        #
        # An EMPTY key is never stored and never looked up. A method with no
        # `tsTypeLinkHash` at all would otherwise collide with any row whose own hash
        # column is blank, and take an owner belonging to something else entirely.
        typeref_owner = {}
        for t in rows(f'{ir}/all-typescript-type-references.csv'):
            h = t.get('tsTypeReferenceUniqueHash') or ''
            if h:
                typeref_owner[h] = (t.get('referenceOwnerKind') or '',
                                    t.get('typeReferenceOwnerHash') or '')
        field_owner = {}
        for fl in rows(f'{ir}/all-typescript-fields.csv'):
            h = fl.get('tsFieldUniqueHash') or ''
            if h:
                field_owner[h] = (fl.get('ownerTypeName') or '',
                                  fl.get('memberKind') or '')

        def enclosing_owner(type_hash):
            """The named declaration an anonymous shape was written inside, or ''."""
            if not type_hash:
                return ''
            kind, owner_hash = typeref_owner.get(type_hash, ('', ''))
            if kind != 'FIELD' or not owner_hash:
                return ''
            name, member_kind = field_owner.get(owner_hash, ('', ''))
            return '' if member_kind.startswith('TYPE_LITERAL_') else name

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
            kind = r.get('methodKind') or ''
            owner = r.get('ownerTypeName') or ''
            if not owner or kind.startswith('TYPE_LITERAL_'):
                owner = enclosing_owner(r.get('tsTypeLinkHash'))
            if not owner:
                owner = mods.get(r.get('tsModuleLinkHash'), '?')
            name = r.get('name') or ''
            # KEYED ON methodKind, not on "the name starts with <". Every synthesised name is
            # angle-bracketed, so the old test sent the MODULE INITIALIZER down the unnamed-arrow
            # path as well, where it took an unrelated variable's name or an `<arrow@line>` label.
            # The compiler side calls it `<module-init>`; matching that is what makes the two
            # sides comparable, which is the whole point.
            if kind == 'MODULE_INITIALIZER':
                name = '<module-init>'
            elif not name or name.startswith('<'):
                name = arrow_name.get(h) or f"<arrow@{r.get('startLine')}>"
            if kind in ('CONSTRUCTOR', 'DEFAULT_CONSTRUCTOR'):
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
    # An accessor edge (PROPERTY_READ / PROPERTY_WRITE) is keyed on the PROPERTY_ACCESS
    # expression, which is no call site; its line comes from the expressions table. The
    # call-sites table is read second so a written call keeps the line the parser gave it.
    for r in rows(f'{ir}/all-typescript-expressions.csv'):
        if r.get('kind') == 'PROPERTY_ACCESS':
            site_line[r['tsExpressionUniqueHash']] = r.get('startLine') or '?'
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
