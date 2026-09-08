#!/usr/bin/env python3
"""COVERAGE GUARD -- the invariant a golden diff structurally cannot check.

Every call site the parser recorded must appear in the engine's output: resolved,
or explicitly flagged ambiguous. A site that appears NOWHERE was dropped
silently, and you cannot notice the absence of something that was never recorded
-- so this is asserted separately and fails the case on its own.

TWO INDEPENDENT INVENTORIES ARE CHECKED, because they fail differently:

  1. the IR's own `all-python-call-sites.csv` -- did the ENGINE drop a site the
     PARSER found?
  2. tier 1 of the CPython oracle -- did the PARSER drop a site CPython's own
     compiler emitted? A site missing from the IR is invisible to check 1, since
     check 1's denominator is the IR itself. This is the check that catches a
     parser-level gap masquerading as an engine that "handled everything".

CHECK 2 WAS DORMANT UNTIL #224, in three independent ways: it was gated on an
`--oracle` flag the suite never passed, its findings never reached the exit status
(`return 1 if absent else 0` read only check 1), and its denominator counted calls
no author wrote. It now runs on every invocation, fails the case, and is scored on
a denominator that can be believed. It needs no external checkout -- the tier-1
machinery is the vendored copy in tools/vendor.

FOUR CORRECTIONS THE DENOMINATOR NEEDED, each measured rather than assumed:

  IMPLICIT SITES are excluded. `class X:` compiles to a call to __build_class__ and
  a comprehension to an immediately-invoked code object; neither is a call the
  author wrote and neither has an IR counterpart. tier1_sites.Site exposes this as
  `.implicit`, for exactly this purpose, and reading it removes what used to
  dominate the output.

  SENTINEL CALLEES are unadjudicable, not gaps. `via` UNKNOWN and CALL_RESULT carry
  an empty name or `<call-result>` (for `f()()`) -- there was no LOAD to read -- so
  they can never match an IR row. Counting them as misses made CALL_RESULT the
  largest apparent gap on four of five corpora. Same split oracle_check.py already
  makes with its `unver` column: a comparison that cannot be made is not a failure.

  THE KEY IS (file, callee name), NOT (file, line). CPython attributes each
  LOAD_METHOD in a fluent chain to the line the method NAME sits on, so
  `sess.query(P).order_by(...)` split over three lines has sites in both
  inventories at different lines. Line-keying alone put one project at 96.7% with
  nothing missing.

  DECORATORS AND MANGLED NAMES are credited. `@lru_cache` is a real call the author
  wrote, recorded in all-python-decorators.csv rather than in the call-site table;
  a CLASS decorator carries pyTypeLinkHash with an EMPTY pyMethodLinkHash, so
  anchoring through the method FK alone drops every one. And CPython mangles
  `self.__x()` to `_Class__x` while the parser records it as written.

FILE SCOPE IS TAKEN FROM THE IR, NOT HARDCODED. #224 proposes reusing
ir_audit.EXCLUDED_DIRS, but that is only right when the IR was built with
excludeTests=true, and this suite passes false -- a fixed list would then exclude
files the IR does contain and hide real gaps. Instead a tier-1 site is scored only
if its file has a module row, and a file with sites and NO module row is reported
as its own gap class unless the parser listed it in skipped-python-files.csv. That
is exact, self-adjusting, and catches the file-level drop a directory list would
mask.

usage: coverage_guard.py <IR-dir> <OUT-dir> <SRC-dir> [--oracle]
       --oracle is accepted and ignored; check 2 always runs.
"""
import csv
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine_edges import IR, edge_rows, rows               # noqa: E402


def main() -> int:
    ir_dir, out_dir, src = sys.argv[1], sys.argv[2], sys.argv[3]
    use_oracle = '--oracle' in sys.argv

    ir = IR(ir_dir, src)
    edges = edge_rows(out_dir)
    if edges is None:
        print(f'SILENT DROP CHECK IMPOSSIBLE: no call-chain-edges.csv in {out_dir}')
        return 1

    emitted = {e['site'] for e in edges}
    parser_sites = rows(os.path.join(ir_dir, 'all-python-call-sites.csv'))
    # Decorator applications are real call sites the parser records separately.
    # An unmodelled decorator is `ambiguous_unknown`, never dropped.
    decorators = rows(os.path.join(ir_dir, 'all-python-decorators.csv'))
    absent = []
    for c in parser_sites:
        hashes = [c.get('pyCallSiteUniqueHash'), c.get('pyExpressionLinkHash')]
        if not any(h and h in emitted for h in hashes):
            absent.append((c.get('startLine', '?'), c.get('calleeName', '?'),
                           c.get('callKind', '?')))
    for d in decorators:
        hashes = [d.get('pyDecoratorUniqueHash'), d.get('pyExpressionLinkHash')]
        if not any(h and h in emitted for h in hashes):
            absent.append((d.get('startLine', '?'), '@' + (d.get('decoratorName') or '?'),
                           'DECORATOR_' + (d.get('kind') or '?')))
    print(f'IR call sites: {len(parser_sites)} + {len(decorators)} decorator applications'
          f'   absent from engine output: {len(absent)}')
    for line, name, kind in sorted(absent, key=lambda x: int(x[0] or 0)):
        print(f'   SILENT DROP  {kind} {name}() at line {line}')

    file_gaps, site_gaps = _tier1_gaps(ir, ir_dir, src)
    for f in sorted(file_gaps)[:25]:
        print(f'   PARSER GAP (file)  {f} — CPython compiles it, the IR has no module row '
              f'for it, and it is not in skipped-python-files.csv')
    for f, line, name, via in sorted(site_gaps)[:25]:
        print(f'   PARSER GAP (site)  {f}:{line} {name} (via {via})')

    return 1 if (absent or file_gaps or site_gaps) else 0


def _tier1_gaps(ir, ir_dir, src):
    """Check 2 — did the PARSER drop a call site CPython's own compiler emitted?

    Returns (file_gaps, site_gaps). See this module's docstring for why each
    exclusion is here; every one of them was a measured source of invented gaps.
    """
    from vendor.normalize import Normalizer                       # noqa: E402
    from vendor.tier1_sites import PINNED, sites_for_tree         # noqa: E402

    # CHECK 2 IS INTERPRETER-PINNED, and it has to be. tier 1 reads the callee off a
    # simulated stack, and the opcode model is not stable across minor versions: 3.12
    # dropped LOAD_METHOD for a flagged LOAD_ATTR, so `math.sqrt(16)` attributes to
    # `sqrt` on 3.10 and to `math` on 3.12. The parser's IR is version-independent, so
    # running the comparison on the wrong interpreter reports the DIFFERENCE as a
    # parser gap. Measured: on 3.12 this check invented 6 gaps across four cases and
    # two projects — every one of them `module.func(...)` — and standalone on 3.10 the
    # same trees are 0. Skipped loudly rather than run wrongly; run-tests.sh invokes
    # the guard with the pinned interpreter for this reason.
    if sys.version_info[:2] != PINNED:
        v = sys.version_info
        print(f'CPython tier-1 parser check: SKIPPED on Python {v[0]}.{v[1]} — tier 1 is '
              f'pinned to {PINNED[0]}.{PINNED[1]} and opcode shapes differ, so a comparison '
              f'here would report version differences as parser gaps')
        return set(), set()

    known_files, skipped = set(), set()
    for m in rows(os.path.join(ir_dir, 'all-python-modules.csv')):
        fp = (m.get('filePath') or '').replace(os.sep, '/')
        if fp:
            known_files.add(fp)
    for k in rows(os.path.join(ir_dir, 'skipped-python-files.csv')):
        fp = (k.get('filePath') or '').replace(os.sep, '/')
        if fp:
            skipped.add(fp)

    credited = set()
    # A site the PARSER also could not name. `TABLE["d"](n)` — the registry-dispatch
    # idiom — has a subscript result as its callee, and the parser records it with an
    # empty calleeName and receiverKind=SUBSCRIPT. tier 1 reports the CONTAINER's name
    # there (its stack model leaves it on top through BINARY_SUBSCR's net effect), so a
    # name-keyed comparison sees `TABLE` against nothing and calls it a gap. Both sides
    # agree there is no nameable callee, so the comparison cannot be made — the same
    # verdict as tier 1's own sentinels, keyed on the line the two sides do agree on.
    # Filed against tier 1 separately; fixing it there needs the locks re-frozen, which
    # only the harness may do.
    nameless = set()
    for c in rows(os.path.join(ir_dir, 'all-python-call-sites.csv')):
        a = ir.anchor(c.get('pyMethodLinkHash'))
        if a is None:
            continue
        if c.get('calleeName'):
            credited.add((a.file, c['calleeName']))
        else:
            try:
                nameless.add((a.file, int(c.get('startLine') or 0)))
            except ValueError:
                pass
    for d in rows(os.path.join(ir_dir, 'all-python-decorators.csv')):
        nm = d.get('decoratorName')
        if not nm:
            continue
        a = ir.anchor(d.get('pyMethodLinkHash'))
        f = a.file if a is not None else ir.type_file.get(d.get('pyTypeLinkHash') or '')
        if f:
            credited.add((f.replace(os.sep, '/'), nm))

    def is_credited(f, nm):
        if (f, nm) in credited:
            return True
        # CPython mangles `self.__x()` inside class C to `_C__x`; the parser records
        # the name as written, so both spellings are the same call.
        m = re.match(r'^_([A-Za-z][A-Za-z0-9_]*?)(__[A-Za-z0-9_]+)$', nm)
        return bool(m) and (f, m.group(2)) in credited

    # ── THE THIRD STATE: ABSENT BECAUSE NOBODY ASKED FOR IT (#305) ──────────
    # `sites_for_tree` walks the SOURCE tree; `known_files` comes from the IR. On an
    # `excludeTests=true` extraction those describe different populations: the parser
    # never SEES an excluded file, so it cannot list it in skipped-python-files.csv
    # either — that relation records files the parser was handed and could not use.
    # Every excluded file therefore landed in `file_gaps`, and the check failed BY
    # CONSTRUCTION on the mode the corpus workflow requires. Reproduced on a package
    # whose tests live inside it, one flag the only difference:
    #
    #     excludeTests=false   4 module rows   0 file gaps
    #     excludeTests=true    2 module rows   1 file gap   <- invented
    #
    # DERIVED, NOT CONFIGURED. #224 proposed a hardcoded directory list and that was
    # correctly rejected: it would hide a real drop on an excludeTests=false run. What
    # IS available is per-directory coverage — a directory in which NO file has a
    # module row was excluded wholesale by the caller, while one where some files are
    # present and one is missing is a real drop. Self-adjusting, and needs no new input.
    #
    # ITS LIMIT, STATED RATHER THAN HIDDEN. This cannot tell "the caller excluded the
    # whole directory" from "the parser dropped the only file in it", so a single-file
    # directory genuinely lost is suppressed. Suppressing the FAILURE is right — a
    # false P0 on every test tree is worse — but suppressing it silently is not, so
    # each wholesale-absent directory is PRINTED with its file count. A directory that
    # should not be there stays visible to a reader without failing the run.
    dir_has_module = set()
    for _kf in known_files:
        dir_has_module.add(_kf.rsplit('/', 1)[0] if '/' in _kf else '')

    def _wholesale_absent(path):
        d = path.rsplit('/', 1)[0] if '/' in path else ''
        return d not in dir_has_module

    excluded_dirs = {}
    file_gaps, site_gaps = set(), set()
    total = unadjudicable = 0
    for s in sites_for_tree(src, Normalizer(src)):
        if s.implicit:
            continue
        if not s.callee_name or s.callee_name.startswith('<'):
            unadjudicable += 1
            continue
        f = s.file.replace(os.sep, '/')
        if f not in known_files:
            # Counted by the FILE gap, not by the site ratio — otherwise a file the
            # parser never saw reports "15/15 credited" beside its own gap.
            if f not in skipped:
                if _wholesale_absent(f):
                    _d = f.rsplit('/', 1)[0] if '/' in f else '.'
                    excluded_dirs.setdefault(_d, set()).add(f)
                else:
                    file_gaps.add(f)
            continue
        total += 1
        if is_credited(f, s.callee_name):
            continue
        if (f, s.line) in nameless:
            unadjudicable += 1
            total -= 1
            continue
        site_gaps.add((f, s.line, s.callee_name, s.via))
    # AN IR WITH NO MODULES AT ALL IS NOT "everything was excluded". Without this an
    # extraction that produced nothing makes every directory wholesale-absent and the
    # check passes in silence — the one outcome worse than a false failure.
    if not known_files:
        print('   PARSER GAP (file)  the IR has NO module rows at all, so nothing was '
              'extracted here; that is an extraction failure, not an exclusion')
        for _fs in excluded_dirs.values():
            file_gaps |= _fs
        excluded_dirs = {}
    for _d, _fs in sorted(excluded_dirs.items()):
        print(f'   excluded by the caller  {_d}/  ({len(_fs)} file(s) with tier-1 sites '
              f'and no module row anywhere in that directory) — not counted as a gap')
    print(f'CPython tier-1 parser check: {total - len(site_gaps)}/{total} adjudicable sites '
          f'credited, {len(site_gaps)} missing, {len(file_gaps)} file(s) absent from the IR '
          f'({unadjudicable} unadjudicable, tier 1 named no callee'
          + (f'; {len(excluded_dirs)} directory(ies) the caller excluded'
             if excluded_dirs else '') + ')')
    return file_gaps, site_gaps


if __name__ == '__main__':
    sys.exit(main())
