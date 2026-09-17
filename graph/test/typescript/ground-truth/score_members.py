#!/usr/bin/env python3
"""Score field_access / type_use against the compiler, at PROJECT scale.

    score_members.py --fields|--types <IR> <RAW> <oracle.tsv> [--label N] [--show-wrong]

POSITIONAL, like ground-truth/score.py: both sides are keyed on
`file:line:column` of the site and `file:line` of the target, because at corpus scale a
naming convention is a second thing that can disagree and a position cannot.

    fields   (accessFile, accessLine, accessCol, direction, targetFile, targetLine)
    types    (refFile, refLine, refCol, targetFile, targetLine)

NOT SCORED, on both sides:
  * a site outside the project. The oracle emits only files under the parser's own roots.
  * a target outside the project: a member or a type declared in node_modules is one the
    engine was not given, and charging either side for it measures the staging.
  * WITH SCORE_PRODUCTION=1, a site or a target in a TEST tree, using score.py's own
    TEST_PATH so the two scorers agree on what production is. A repository's test tree is
    routinely larger than the library it tests, and its property accesses are an easier
    population than real code, so leaving them in raises the rate rather than diluting it.
  * a site the ENGINE has and the oracle's program does not contain. The oracle builds one
    program per discovered tsconfig; a file no config includes is not in the truth set, so
    scoring the engine's rows for it would charge it against nothing. Counted and printed.

TWO PRECISIONS, because a tier says which one applies. STRICT charges every emitted row:
one wrong row is one false positive, which is the right measure for a `known_edge`. SITE
asks the question a `multi_inferred` row actually claims -- is the compiler's answer among
the ones emitted for this site -- and is the measure for a sound set. Reporting only the
first punishes the engine for being honest about an ambiguous receiver; reporting only the
second hides a site that resolved to one wrong thing. Both are printed.

THE COLUMN IS NOT PART OF THE TYPE KEY. A type reference's position in the IR is the
reference row's, and the parser records a reference's start where the compiler records the
entity NAME's — they differ by the qualifier on `a.B`. Sites are keyed on (file, line) for
types and on (file, line, column) for fields, where both sides record the access node.
"""
import collections, csv, os, sys
csv.field_size_limit(10 ** 9)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score import is_test_path  # noqa: E402


def rows(path):
    with open(path, newline='', encoding='utf-8', errors='replace') as f:
        r = list(csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE))
    if not r:
        return []
    hdr = r[0]
    return [dict(zip(hdr, x + [''] * (len(hdr) - len(x)))) for x in r[1:]]


def main():
    argv = sys.argv[1:]
    mode = 'fields' if '--fields' in argv else 'types'
    label = 'project'
    if '--label' in argv:
        i = argv.index('--label'); label = argv[i + 1]; del argv[i:i + 2]
    args = [a for a in argv if not a.startswith('--')]
    ir, raw, oracle_path = args[0], args[1], args[2]

    modules = {m['tsModuleUniqueHash']: m['filePath'] for m in rows(f'{ir}/all-typescript-modules.csv')}
    expr = {}
    for e in rows(f'{ir}/all-typescript-expressions.csv'):
        expr[e['tsExpressionUniqueHash']] = (modules.get(e.get('tsModuleLinkHash'), ''),
                                             e.get('startLine', ''), e.get('startColumn', ''))
    fields = {f['tsFieldUniqueHash']: (modules.get(f.get('tsModuleLinkHash'), '') or f.get('filePath', ''),
                                       f.get('startLine', ''))
              for f in rows(f'{ir}/all-typescript-fields.csv')}
    types = {t['tsTypeUniqueHash']: (t.get('filePath', ''), t.get('startLine', ''))
             for t in rows(f'{ir}/all-typescript-types.csv')}
    trefs = {}
    for r in rows(f'{ir}/all-typescript-type-references.csv'):
        trefs[r['tsTypeReferenceUniqueHash']] = (modules.get(r.get('tsModuleLinkHash'), ''),
                                                 r.get('startLine', ''))

    production = os.environ.get('SCORE_PRODUCTION') == '1'
    keep = (lambda f: not is_test_path(f)) if production else (lambda f: True)
    oracle = set()
    oracle_files = set()
    skipped_test = 0
    for r in rows(oracle_path):
        if mode == 'fields':
            oracle_files.add(r['accessFile'])
            if not keep(r['accessFile']) or not keep(r['targetFile']):
                skipped_test += 1
                continue
            oracle.add((r['accessFile'], r['accessLine'], r['accessCol'], r['direction'],
                        r['targetFile'], r['targetLine']))
        else:
            oracle_files.add(r['refFile'])
            if not keep(r['refFile']) or not keep(r['targetFile']):
                skipped_test += 1
                continue
            oracle.add((r['refFile'], r['refLine'], r['targetFile'], r['targetLine']))

    engine = set()
    sites = set()
    resolved = set()
    tiers = collections.Counter()
    off_program = 0
    not_client = 0

    src = os.path.join(raw, 'field-access.csv' if mode == 'fields' else 'type-use.csv')
    for line in open(src, encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if mode == 'fields':
            if len(f) < 6:
                continue
            site, caller, field, prov, tier, access = f[:6]
            sites.add(site)
            tiers[tier] += 1
            if field != '-':
                resolved.add(site)
            loc = expr.get(site)
            if loc is None or loc[0] not in oracle_files:
                off_program += 1
                continue
            if field == '-' or field not in fields:
                not_client += 1
                continue
            tf, tl = fields[field]
            if not keep(loc[0]) or not keep(tf):
                skipped_test += 1
                continue
            for d in (['READ'] if access == 'read' else ['WRITE'] if access == 'write'
                      else ['READ', 'WRITE']):
                engine.add((loc[0], loc[1], loc[2], d, tf, tl))
        else:
            if len(f) < 10:
                continue
            ref, owner, ownerKind, et, em, t, prov, ctx, depth, tier = f[:10]
            sites.add(ref)
            tiers[tier] += 1
            if t != '-':
                resolved.add(ref)
            loc = trefs.get(ref)
            if loc is None or loc[0] not in oracle_files:
                off_program += 1
                continue
            if t == '-' or t not in types:
                not_client += 1
                continue
            tf, tl = types[t]
            if not keep(loc[0]) or not keep(tf):
                skipped_test += 1
                continue
            engine.add((loc[0], loc[1], tf, tl))

    tp = len(engine & oracle)
    fp = len(engine - oracle)
    fn = len(oracle - engine)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    # Per SITE: the site key is everything but the target, so a site with several emitted
    # targets is one entry on each side.
    sk = (lambda r: r[:4]) if mode == 'fields' else (lambda r: r[:2])
    e_by, o_by = collections.defaultdict(set), collections.defaultdict(set)
    for r in engine:
        e_by[sk(r)].add(r)
    for r in oracle:
        o_by[sk(r)].add(r)
    shared = set(e_by) & set(o_by)
    hit = sum(1 for k in shared if e_by[k] & o_by[k])
    site_scored = len(set(e_by))
    site_prec = hit / site_scored if site_scored else 0.0
    widths = [len(v) for v in e_by.values()]
    print(f"{label} [{mode}]")
    print(f"  precision {prec:.4f}   ({tp} correct, {fp} wrong)   strict, per row")
    print(f"  site      {site_prec:.4f}   ({hit} of {site_scored} sites carry the compiler's answer; "
          f"mean set {sum(widths) / len(widths):.2f})" if widths else "  site      n/a")
    print(f"  recall    {rec:.4f}   ({tp} of {tp + fn} the compiler resolved)")
    print(f"  sites {len(sites)}   resolved {len(resolved)} "
          + (f"({len(resolved) / len(sites) * 100:.1f}%)" if sites else ""))
    print("  tiers " + "  ".join(f"{k}={v}" for k, v in sorted(tiers.items())))
    print(f"  not scored: {off_program} in a file no tsconfig includes, "
          f"{not_client} whose target is not a project declaration"
          + (f", {skipped_test} in a test tree" if production else ""))
    if '--show-wrong' in sys.argv:
        for s in sorted(engine - oracle)[:30]:
            print("    WRONG   " + "  ".join(s))
    if '--show-missing' in sys.argv:
        for s in sorted(oracle - engine)[:30]:
            print("    MISSING " + "  ".join(s))


if __name__ == '__main__':
    main()
