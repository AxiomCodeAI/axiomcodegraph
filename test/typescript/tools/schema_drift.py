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
                     'src/typescript/souffle/decls_*.dl'))
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
        want = {}
        with open(mp, encoding='utf-8', errors='replace') as fh:
            r = _csv.reader(fh, delimiter='\t'); h = next(r)
            if 'parameterCount' in h and 'tsMethodUniqueHash' in h:
                C, H = h.index('parameterCount'), h.index('tsMethodUniqueHash')
                for row in r:
                    if len(row) > max(C, H) and row[C].isdigit():
                        want[row[H]] = int(row[C])
        seen = {}
        kinds = set()
        with open(pp, encoding='utf-8', errors='replace') as fh:
            r = _csv.reader(fh, delimiter='\t'); h = next(r)
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
        if broken:
            bad.append(
                f'positional invariant: {broken} methods whose NONE-kind parameter rows '
                f'are not exactly positions 0..parameterCount-1. The engine separates '
                f'real parameters from destructuring bound names on that property; '
                f'kinds seen: {sorted(kinds)}')

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
