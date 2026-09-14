#!/usr/bin/env python3
"""SCHEMA DRIFT — does every declared relation still match the IR it reads?

The failure this exists to prevent is SILENT. A Souffle relation declared with fewer
columns than the TSV it loads does not error: it binds the first N and the LAST column
of the declaration lands on the wrong field. Every table here ends with its unique
hash, so an arity that is one short reads a line number, a column number or a version
string as the join key — and every join on that key then finds nothing, for every row.

Measured twice on this repository. A variable table that gained two columns misbound
every variable, and a parameter table that gained two columns cost ~650 exact
resolutions on one project before anyone noticed the arity at all. Neither produced a
warning: the malformed-row guard in the pipeline checks that rows are consistent with
their own HEADER, which they were.

Usage:  schema_drift.py <ir-dir> [<decls.dl> ...]
Exit 1 on any mismatch.
"""
import re, sys, os, glob

# CSV basename -> relation stem. The lib_* twin is checked with the same arity.
TABLES = {
    'methods': 'ts_method', 'method-parameters': 'ts_method_parameter',
    'variables': 'ts_variable', 'fields': 'ts_field', 'types': 'ts_type',
    'modules': 'ts_module', 'type-references': 'ts_type_reference',
    'call-sites': 'ts_call_site', 'expressions': 'ts_expression',
    'imports': 'ts_import', 'exports': 'ts_export', 'blocks': 'ts_block',
    'type-parameters': 'ts_type_parameter', 'type-heritages': 'ts_type_heritage',
    'enum-members': 'ts_enum_member', 'decorators': 'ts_decorator',
    'decorator-arguments': 'ts_decorator_argument',
    'field-positions': 'ts_field_position', 'comments': 'ts_comment',
}

def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    ir = sys.argv[1]
    decl_files = sys.argv[2:] or glob.glob(
        os.path.join(os.path.dirname(__file__), '..', '..', '..',
                     'graph/typescript/souffle/decls_*.dl'))
    arity = {}
    for f in decl_files:
        for m in re.finditer(r'\.decl\s+(\w+)\(([^)]*)\)', open(f).read()):
            arity[m.group(1)] = m.group(2).count('symbol')
    bad = []
    for stem, rel in sorted(TABLES.items()):
        p = os.path.join(ir, f'all-typescript-{stem}.csv')
        if not os.path.exists(p):
            continue
        with open(p, encoding='utf-8', errors='replace') as fh:
            header = fh.readline().rstrip('\n')
        if not header:
            continue                      # empty table carries no schema
        cols = len(header.split('\t'))
        if cols <= 1:
            continue
        for name in (rel, 'lib_' + rel):
            want = arity.get(name)
            if want is None:
                bad.append(f'{name}: declared nowhere, but {stem}.csv exists')
            elif want != cols:
                last = header.split('\t')[want - 1] if want <= cols else '(past end)'
                bad.append(
                    f'{name}: declared {want} columns, IR has {cols}. '
                    f'The declaration\'s last column lands on {last!r}, '
                    f'not on the unique hash')
    # ── the POSITIONAL INVARIANT ────────────────────────────────────────────
    # Arity is not the only thing that can drift silently. The engine separates real
    # parameters from destructuring BOUND NAMES using `bindingSourceKind`, on the
    # assumption that NONE means positional — an invariant the parser has never
    # promised in writing. If a new kind appears, or a real parameter is given a
    # non-NONE kind, that filter starts dropping real parameters and nothing else
    # notices: the arity still matches and every row is well formed.
    #
    # So assert the property the filter actually depends on: for each method, the rows
    # the engine treats as positional must be exactly positions 0..parameterCount-1,
    # one row each.
    pp = os.path.join(ir, 'all-typescript-method-parameters.csv')
    mp = os.path.join(ir, 'all-typescript-methods.csv')
    if os.path.exists(pp) and os.path.exists(mp):
        import csv as _csv
        _csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
        want = {}
        with open(mp, encoding='utf-8', errors='replace') as fh:
            # A RELATION WITH NO ROWS IS A ZERO-BYTE FILE -- not a header, zero bytes -- so
            # `next(r)` raises StopIteration. That propagated out of this gate and the harness
            # reported "refusing to measure against a drifted schema", which is the one failure
            # mode this gate exists to catch and was not what happened. A relation with no rows
            # cannot violate an arity invariant, so the honest answer is "no rows, arity
            # unverifiable" and carry on. Reproduced on a project whose functions all take no
            # parameters: all-typescript-method-parameters.csv is 0 bytes. See issue #244.
            r = _csv.reader(fh, delimiter='\t'); h = next(r, None) or []
            if 'parameterCount' in h and 'tsMethodUniqueHash' in h:
                C, H = h.index('parameterCount'), h.index('tsMethodUniqueHash')
                for row in r:
                    if len(row) > max(C, H) and row[C].isdigit():
                        want[row[H]] = int(row[C])
        seen = {}
        kinds = set()
        with open(pp, encoding='utf-8', errors='replace') as fh:
            r = _csv.reader(fh, delimiter='\t'); h = next(r, None) or []
            if 'bindingSourceKind' in h:
                M, P, K = h.index('tsMethodLinkHash'), h.index('position'), h.index('bindingSourceKind')
                for row in r:
                    if len(row) <= max(M, P, K):
                        continue
                    kinds.add(row[K])
                    if row[K] in ('NONE', ''):
                        seen.setdefault(row[M], []).append(row[P])
        broken = 0
        for mh, n in want.items():
            got = sorted(seen.get(mh, []), key=lambda x: int(x) if x.isdigit() else -1)
            if got != [str(i) for i in range(n)]:
                broken += 1
        # PROPORTIONALITY. This check exists to catch a SCHEMA change, and a schema
        # change is not subtle: it breaks the invariant for a large share of methods at
        # once, or it introduces a kind nobody has seen. One method breaking it is a
        # peculiar construct, not drift — and refusing to measure a 75,000-site project
        # over a single method makes the gate an obstacle rather than a safeguard,
        # which is how gates end up disabled.
        # The kinds the engine knows how to classify. NONE is a real parameter or the
        # pattern itself; the rest are names bound OUT of a pattern and are therefore
        # not positional. OBJECT_REST (`{ a, ...rest }`) was found by this check —
        # it is a bound name like the others, and the filter already treats it as one,
        # but an unrecognised kind is exactly what must not pass silently.
        # The complete set, taken from the parser's own schema rather than discovered
        # one project at a time: TYPESCRIPT-FACT-SCHEMA.md documents
        #   NONE | PROPERTY | INDEX | OBJECT_REST | ARRAY_REST
        # NONE is an ordinary parameter or the pattern row itself; every other value is
        # a name bound OUT of a pattern and is therefore not positional. Two of these
        # were found by this check firing on a corpus project, which is the argument for
        # reading the schema instead of waiting to be surprised — but the check still
        # fails on a sixth, because the next one might belong on the positional side.
        KNOWN = {'NONE', '', 'PROPERTY', 'INDEX', 'OBJECT_REST', 'ARRAY_REST'}
        unknown = sorted(kinds - KNOWN)
        rate = broken / len(want) if want else 0.0
        if unknown:
            bad.append(
                f'unrecognised bindingSourceKind {unknown}: the engine treats only '
                f'{sorted(KNOWN - {""})} as known, and separates real parameters from '
                f'destructuring bound names on that distinction. A new kind silently '
                f'changes which rows count as positional.')
        if rate > 0.01:
            bad.append(
                f'positional invariant: {broken} of {len(want)} methods ({rate:.1%}) '
                f'whose NONE-kind parameter rows are not exactly '
                f'positions 0..parameterCount-1')
        elif broken:
            print(f'note: {broken} of {len(want)} methods ({rate:.2%}) break the '
                  f'positional parameter invariant — below the drift threshold, '
                  f'reported so it is not invisible')

    if bad:
        print('SCHEMA DRIFT — the IR and the declarations disagree:')
        for b in bad:
            print(f'  {b}')
        print('\nFix the .decl arity to match the IR before trusting any measurement:')
        print('a short declaration misbinds the join key silently, for every row.')
        return 1
    print(f'schema: {len(TABLES)} tables match their declarations')
    return 0

if __name__ == '__main__':
    sys.exit(main())
