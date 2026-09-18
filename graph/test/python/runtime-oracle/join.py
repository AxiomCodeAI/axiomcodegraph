#!/usr/bin/env python3
"""Join what RAN against what the ENGINE said, per call site.

THE JOIN KEY IS A SITE, NOT AN EDGE. An edge set answers "does the engine know
A can call B"; it cannot answer "at THIS call the engine named the wrong
target", and the second is the defect class worth finding. So both sides are
folded to

    (caller anchor, site line)  ->  {callee anchor}

and compared per key. The caller anchor makes two different functions written on
one line distinguishable; the site line is what the runtime can observe exactly
(the caller frame's f_lineno at the call).

SYMMETRY. Every fold comes from `tools/vendor/normalize.py`, the module the
engine side already folds through -- decorators onto the `def` line (Rule 1),
comprehension scopes into the enclosing function (Rule 3), module bodies onto
line 0 (Rule 5). Folding the runtime side by hand here would manufacture
defects that look exactly like engine bugs.

THE VERDICTS, and what each one means for the engine:

  agree             the engine names, at this site, the callable that ran.
  wrong_target      the engine resolved the site to a target, that target
                    never ran there, and something else did. A PRECISION
                    defect: the graph asserts an edge that is not the one
                    taken.
  unresolved_but_ran   the engine accounted for the site and declared it
                    unresolved; the run shows exactly what it calls. These are
                    RECOVERABLE -- the reason string says which rule gave up.
  over_approximate  the engine offers several targets, the right one among
                    them. Sound, imprecise; counted, never called a defect.
  site_gap          the site executed and the engine has NO row for it at all.
                    Conservation says this must be zero.
  not_executed      the engine has the site; the test suite never ran it. NOT
                    a defect and never scored as one -- a runtime oracle can
                    only speak about what executed.

NATIVE CALLEES (Rule 7) are joined by NAME, never by anchor. `boundary_native`
on the engine side and `NATIVE:x` on the runtime side agree when both say the
call leaves Python; an engine that gave a native call a file anchor has
fabricated one, and that is reported separately.

usage: join.py --root SRC --ir IR --out ENGINE_OUT --trace TRACEDIR [--json F]
"""
from __future__ import annotations

import argparse
import ast
import collections
import csv
import json
import os
import sys

csv.field_size_limit(10 ** 9)

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(os.path.dirname(HERE), 'tools')
sys.path.insert(0, TOOLS)

from vendor.normalize import (Anchor, Normalizer, COMPREHENSION_SCOPES,  # noqa: E402
                              ir_anchor_line)
import engine_edges                                                      # noqa: E402

NATIVE_PREFIX = 'NATIVE:'


class ImportLines:
    """Lines occupied by an `import` statement, per file.

    RULE 10, AND THE SAME ARGUMENT. `from .core import Command` compiles to
    IMPORT_NAME / IMPORT_FROM and no CALL, so the bytecode oracle does not see a
    site there either -- but the import MACHINERY calls `hasattr(module,
    '__path__')`, and under PEP 562 a module that defines `__getattr__` answers
    that in Python. The profiler therefore records a real client call at a line
    where no call is written.

    MEASURED on a CLI library: 74 of 708 executed sites (10.4%) were this and
    nothing else -- one per `from . import X` line in a package that defines a
    module-level `__getattr__` for its deprecated names. Scored naively it reads
    as the engine dropping a tenth of the project's call sites.

    The probe is retained and tagged, never dropped. An attribute access that
    really does route through a module `__getattr__` is a different thing, is
    written in the source, and is still scored.

    This lives here and not in `vendor/normalize.py` on purpose: that file is a
    byte-for-byte copy of the shared harness and `tools/check_vendor.py` fails
    if it drifts.
    """

    def __init__(self):
        self._per_file = {}

    def covers(self, norm: Normalizer, path: str, line: int) -> bool:
        p = path if os.path.isabs(path) else os.path.join(norm.root, path)
        if not norm.inside(p):
            return False
        rel = norm.rel(p)
        if rel not in self._per_file:
            lines = set()
            try:
                with open(os.path.join(norm.root, rel), 'rb') as fh:
                    tree = ast.parse(fh.read().decode('utf-8', 'replace'))
                for node in ast.walk(tree):
                    if isinstance(node, (ast.Import, ast.ImportFrom)):
                        for ln in range(node.lineno, (getattr(node, 'end_lineno', None) or node.lineno) + 1):
                            lines.add(ln)
            except (OSError, SyntaxError, ValueError):
                lines = set()
            self._per_file[rel] = lines
        return line in self._per_file[rel]


# ── the runtime side ────────────────────────────────────────────────────────
def runtime_sites(trace_dir: str, norm: Normalizer):
    """-> {(callerKey, line): {calleeKey: count}}, plus the definitional ones.

    Rule 10: executing a module body or a class body is a DEFINITION event, not
    a call site. It is retained under its own key and excluded from the scored
    set, exactly as the CPython oracle excludes it, so the two denominators stay
    comparable.
    """
    sites = collections.defaultdict(collections.Counter)
    imports = ImportLines()
    definitional = collections.Counter()
    implicit = collections.Counter()
    native_sites = collections.defaultdict(collections.Counter)
    files = 0
    rows = 0
    displaced = [n for n in os.listdir(trace_dir) if n.startswith('displaced-')]
    if displaced:
        sys.stderr.write(
            'refusing to score: the profiler was displaced in %d process(es), so the '
            'trace is partial and every missing call would read as a dropped site (%s)\n'
            % (len(displaced), ', '.join(sorted(displaced))))
        raise SystemExit(3)
    for name in sorted(os.listdir(trace_dir)):
        if not (name.startswith('trace-') and name.endswith('.tsv')):
            continue
        files += 1
        with open(os.path.join(trace_dir, name), encoding='utf-8') as fh:
            rd = csv.DictReader(fh, delimiter='\t')
            for r in rd:
                rows += 1
                caller = _anchor_of(norm, r['callerFile'], int(r['callerLine']), r['callerName'])
                if caller is None:
                    continue                     # the caller is not client code
                n = int(r['count'])
                line = _site_line(norm, r['callerFile'], int(r['siteLine']))
                cname = r['calleeName']
                # Rule 10, the SITE half. The compiler synthesised these calls;
                # no call is written in the source, so demanding a site for one
                # scores the engine against an artefact of the interpreter.
                # `__build_class__` is every `class` statement, and the
                # immediately-invoked comprehension code object is every
                # comprehension. Both are RETAINED, tagged, never silently
                # dropped -- that distinction is the whole point of the harness.
                if (cname == 'NATIVE:builtins.__build_class__'
                        or cname in COMPREHENSION_SCOPES
                        or imports.covers(norm, r['callerFile'], line)):
                    implicit[(caller.key(), line, cname)] += n
                    continue
                if cname.startswith(NATIVE_PREFIX):
                    native_sites[(caller.key(), line)][cname] += n
                    continue
                callee = _anchor_of(norm, r['calleeFile'], int(r['calleeLine']), cname)
                if callee is None:
                    continue                     # into a library: scored elsewhere
                if cname == '<module>' or norm.kind(callee) == 'classbody':
                    definitional[(caller.key(), line, callee.key())] += n
                    continue                     # Rule 10, the EDGE half
                sites[(caller.key(), line)][callee.key()] += n
    return sites, native_sites, definitional, implicit, files, rows


def _site_line(norm: Normalizer, path: str, line: int) -> int:
    """Rule 1, applied to the SITE line and not only to the callable's.

    A decorator application is a call, and the two sides disagree about which
    line it is written on: the IR records the `@deco` line, CPython's frame
    reports the `def` line underneath it. Neither is wrong -- `@deco` and the
    `def` are one statement -- but joined raw, EVERY decorator application is an
    off-by-one and reads as a site the engine dropped. Measured on the selftest:
    one `@trace` produced one `site_gap`, and there was no gap.

    Folding both sides through `anchor_for` collapses the pair onto the `def`
    line. It is the same fold Rule 1 already applies to a callable's identity,
    applied to the site, and it is applied to BOTH sides here.
    """
    # Both sides call this, and they spell the file differently: the engine
    # side has a root-relative path, the runtime side an absolute co_filename.
    # `Normalizer.rel` on a bare relative path resolves it against the CWD and
    # hands back an absolute path OUTSIDE the root, so the index came back None
    # and the fold silently did nothing -- the off-by-one it exists to remove
    # survived, still reported as a dropped site.
    p = path if os.path.isabs(path) else os.path.join(norm.root, path)
    if not norm.inside(p):
        return line
    idx = norm.index(p)
    return idx.anchor_for(line) if idx else line


def _anchor_of(norm: Normalizer, path: str, line: int, co_name: str):
    """A raw (co_filename, co_firstlineno, co_name) folded to an Anchor, or None."""
    if not norm.inside(path):
        return None
    if co_name == '<module>':
        return Anchor(norm.rel(path), 0)                       # Rule 5
    a = norm.anchor(path, line)                                # Rule 1
    if co_name in COMPREHENSION_SCOPES:
        a = norm.fold_scope(a, co_name)                        # Rule 3
    return a


def rta_unreachable_targets(ir_dir: str, out_dir: str, norm: Normalizer):
    """Anchors of methods the engine could NOT have named, and why (#937).

    THE HARNESS TRACES A CHECKOUT AND SCORES A SUBTREE, and when those differ a
    receiver built only in the untraced part makes a right answer look wrong. A
    template engine declares `self.loader: BaseLoader`, whose `get_source`
    raises NotImplementedError, and constructs its concrete loaders only in
    `tests/`. Parsing `src/` alone, RTA records none of them as instantiated and
    the call resolves to the base; the trace, which ran the tests, saw the
    subclasses. Scored naively that is a `wrong_target` -- and no sound rule
    could have named those overrides, because in the program the engine was
    given, nothing constructs them.

    MEASURED: 3 of the 4 wrong_target verdicts on one subject, and 14 of 124
    missing_target, are this and nothing else.

    RTA IS READ FROM THE ENGINE, NOT RE-DERIVED. `resolution-type-instantiated.csv`
    is the set the engine's own widening rests on; a second implementation here
    would drift from it and the disagreement would be argued as an oracle bug.

    A method with NO owning type (a module-level function) is never marked: it
    needs no receiver, so RTA has nothing to say about it.
    """
    inst = set()
    path = os.path.join(out_dir, 'resolution-type-instantiated.csv')
    if os.path.exists(path):
        with open(path, encoding='utf-8', errors='replace') as fh:
            for row in csv.reader(fh, delimiter='\t'):
                if len(row) > 1:
                    inst.add(row[1])
    if not inst:
        return set()
    out = set()
    for m in engine_edges.rows(os.path.join(ir_dir, 'all-python-methods.csv')):
        owner = m.get('pyTypeLinkHash') or ''
        if not owner or owner in inst:
            continue
        rel = (m.get('filePath') or '').replace(os.sep, '/')
        try:
            line = int(m.get('startLine') or 0)
        except ValueError:
            line = 0
        idx = norm.index(os.path.join(norm.root, rel))
        out.add('%s:%d' % (rel, ir_anchor_line(idx, line, m.get('methodKind', ''))))
    return out


# ── the engine side ─────────────────────────────────────────────────────────
def expression_positions(ir_dir: str):
    """Expression hash -> (relpath, startLine), for the edges that are NOT sites.

    `engine_edges.IR.site_pos` covers call sites and decorators, because those
    are what a golden needs. The engine also emits edges whose site is a plain
    EXPRESSION -- a property read is the documented one (graph/python/README.md:
    "some edges are not sites"). Joining without them makes the harness blind to
    exactly those edges, and blindness reads as `wrong_target`: measured on the
    selftest, `Greeter.of().name` ran `of` AND the property getter, the engine
    had both, and the getter's edge was invisible here -- a manufactured defect
    of precisely the kind normalize.py exists to prevent.
    """
    mod_file = {}
    for m in engine_edges.rows(os.path.join(ir_dir, 'all-python-modules.csv')):
        h = m.get('pyModuleUniqueHash') or m.get('pyModuleLinkHash')
        if h:
            mod_file[h] = (m.get('filePath') or '').replace(os.sep, '/')
    pos = {}
    for e in engine_edges.rows(os.path.join(ir_dir, 'all-python-expressions.csv')):
        h = e.get('pyExpressionUniqueHash')
        rel = mod_file.get(e.get('pyModuleLinkHash'))
        if not h or not rel:
            continue
        try:
            pos[h] = (rel, int(e.get('startLine') or 0))
        except ValueError:
            continue
    # A METACLASS_CREATION edge's site is the TYPE, because the `class` statement is
    # what runs; there is no expression and no call site to point at. Without this the
    # harness cannot see those edges at all, and a metaclass `__new__` that the engine
    # DOES emit is reported as a site the engine dropped. Measured on a template
    # engine: 69 executed class statements, every one of them scored `site_gap` while
    # the edge was in call-chain-edges.csv the whole time.
    for t in engine_edges.rows(os.path.join(ir_dir, 'all-python-types.csv')):
        h = t.get('pyTypeUniqueHash')
        rel = (t.get('filePath') or '').replace(os.sep, '/')
        if not h or not rel:
            continue
        try:
            pos[h] = (rel, int(t.get('startLine') or 0))
        except ValueError:
            continue
    return pos


def engine_sites(ir_dir: str, out_dir: str, src_root: str, norm: Normalizer):
    """-> ({(callerKey, line): {calleeKey}}, statuses, site->reason)."""
    ir = engine_edges.IR(ir_dir, src_root)
    edges = engine_edges.edge_rows(out_dir)
    if edges is None:
        sys.stderr.write('no call-chain-edges.csv in %s\n' % out_dir)
        raise SystemExit(4)
    expr_pos = expression_positions(ir_dir)
    sites = collections.defaultdict(set)
    status = collections.defaultdict(set)
    native = collections.defaultdict(set)
    for e in edges:
        caller = ir.anchor(e['caller'])
        if caller is None:
            continue
        pos = ir.site_pos.get(e['site'])
        if pos is not None:
            rel, _, tail = pos.rpartition(':')
            try:
                line = int(tail)
            except ValueError:
                continue
        elif e['site'] in expr_pos:
            rel, line = expr_pos[e['site']]
        else:
            continue
        line = _site_line(norm, rel or caller.file, line)
        key = (caller.key(), line)
        status[key].add(e['status'])
        callee = ir.anchor(e['callee']) if e['callee'] else None
        if callee is not None and e['prov'] == 'client':
            sites[key].add(callee.key())
        elif e['kind'] == 'boundary_native' or e['prov'] != 'client':
            native[key].add(e['status'])
    return ir, sites, status, native


RESOLVED_STATUSES = {'resolved', 'single_inferred'}


UNRESOLVED_STATUSES = {'ambiguous_unknown'}


def classify(rt_sites, eng_sites, eng_status):
    """Verdicts, with the line-granularity caveat built into the definitions.

    THE JOIN IS PER LINE AND SEVERAL CALLS FIT ON ONE. `help_option(*names)(self)`
    is two sites; the engine resolves the first and may leave the second
    unresolved, and a naive set comparison then says the engine named the wrong
    target when it named one right one and declined the other. So:

      * `wrong_target` requires DISJOINT sets. If nothing the engine names ran,
        the engine is wrong about this line whatever the site count is.
      * a line where the engine names a strict SUBSET of what ran is
        `missing_target` when every site on it was resolved, and
        `unresolved_but_ran` when any site on it was declared unresolved --
        because the second is the engine saying "I do not know", which is a
        different failure from the engine saying "it is this one".
    """
    verdicts = collections.Counter()
    detail = collections.defaultdict(list)
    for key, ran in sorted(rt_sites.items()):
        got = eng_sites.get(key, set())
        st = eng_status.get(key, set())
        ran_set = set(ran)
        if not st:
            verdicts['site_gap'] += 1
            detail['site_gap'].append((key, sorted(ran_set), sorted(st)))
        elif ran_set == got:
            verdicts['agree'] += 1
        elif ran_set < got:
            verdicts['over_approximate'] += 1
            detail['over_approximate'].append((key, sorted(ran_set), sorted(got)))
        elif got and not (ran_set & got):
            verdicts['wrong_target'] += 1
            detail['wrong_target'].append((key, sorted(ran_set), sorted(got)))
        elif st & UNRESOLVED_STATUSES:
            verdicts['unresolved_but_ran'] += 1
            detail['unresolved_but_ran'].append((key, sorted(ran_set), sorted(got) or sorted(st)))
        else:
            verdicts['missing_target'] += 1
            detail['missing_target'].append((key, sorted(ran_set), sorted(got)))
    executed = set(rt_sites)
    verdicts['not_executed'] = len([k for k in eng_status if k not in executed])
    return verdicts, detail


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True, help='subject source root, as parsed')
    ap.add_argument('--ir', required=True)
    ap.add_argument('--out', required=True, help='engine output dir')
    ap.add_argument('--trace', required=True, help='directory of trace-*.tsv')
    ap.add_argument('--json', default=None)
    ap.add_argument('--show', type=int, default=25, help='examples per verdict')
    args = ap.parse_args()

    norm = Normalizer(args.root)
    rt, rt_native, definitional, implicit, nfiles, nrows = runtime_sites(args.trace, norm)
    ir, eng, eng_status, eng_native = engine_sites(args.ir, args.out, args.root, norm)
    verdicts, detail = classify(rt, eng, eng_status)

    # #937. AN ANNOTATION, NOT A RECLASSIFICATION. The verdict is retained and the
    # reader is told how much of it rests on a receiver the analysed program never
    # constructs. Reclassifying would silently swallow a genuine miss whose target
    # happens to sit on a rarely-built class, and a suppressed defect is exactly what
    # this harness exists to prevent.
    unreachable = rta_unreachable_targets(args.ir, args.out, norm)
    outside = collections.Counter()
    for verdict in ('missing_target', 'wrong_target', 'unresolved_but_ran', 'site_gap'):
        for key, ran, got in detail.get(verdict, []):
            if ran and all(r in unreachable for r in ran):
                outside[verdict] += 1

    # RULE 7, AS A CHECK RATHER THAN A DEFINITION. A site where the only thing that ran
    # is a C function has no source anchor to resolve to. An engine that names a client
    # method there has fabricated one. Reported separately and NOT as a verdict: a line
    # may hold a second call that short-circuited away, so the count is a lead to read,
    # not a defect on its own.
    native_only = [(k, sorted(v), sorted(eng.get(k, ())))
                   for k, v in sorted(rt_native.items())
                   if k not in rt and eng.get(k)]

    print('runtime   %d trace file(s), %d raw rows, %d executed client sites'
          % (nfiles, nrows, len(rt)))
    print('          %d native-only sites, %d definitional and %d implicit events '
          '(Rule 10, retained and unscored)'
          % (len(rt_native), len(definitional), len(implicit)))
    print('engine    %d sites accounted for, %d with a client target'
          % (len(eng_status), len(eng)))
    print()
    order = ('agree', 'over_approximate', 'unresolved_but_ran', 'missing_target',
             'wrong_target', 'site_gap')
    scored = sum(verdicts[k] for k in order)
    for k in order + ('not_executed',):
        n = verdicts[k]
        pct = ('%6.2f%%' % (100.0 * n / scored)) if scored and k != 'not_executed' else '       '
        note = ''
        if outside.get(k):
            note = '   (%d with a receiver this program never constructs)' % outside[k]
        print('  %-20s %6d %s%s' % (k, n, pct, note))
    if sum(outside.values()):
        print('\n  %d verdict(s) above rest on a type RTA never saw constructed, so no sound'
              '\n  rule could have named the target: the receiver was built outside the parsed'
              '\n  tree. Annotated, not reclassified.' % sum(outside.values()))

    def label(anchor_key):
        if anchor_key.startswith(NATIVE_PREFIX):
            return anchor_key
        f, _, l = anchor_key.rpartition(':')
        return '%s (%s)' % (anchor_key, norm.qualname(Anchor(f, int(l))))

    if native_only:
        print('\n── native-only sites the engine gave a client target ── %d' % len(native_only))
        for (caller, line), ran, got in native_only[:args.show]:
            print('  %s:%d   ran %s   engine %s' % (caller, line, ran, got))

    for k in ('wrong_target', 'missing_target', 'unresolved_but_ran', 'site_gap',
              'over_approximate'):
        if not detail[k]:
            continue
        print('\n── %s ── %d' % (k, len(detail[k])))
        for (caller, line), ran, got in detail[k][:args.show]:
            print('  %s:%d   ran %s   engine %s'
                  % (caller, line, [label(x) for x in ran], [str(x) for x in got]))

    if args.json:
        with open(args.json, 'w', encoding='utf-8') as fh:
            json.dump({'verdicts': dict(verdicts),
                       'native_only_with_client_target': len(native_only),
                       'receiver_outside_rta': dict(outside),
                       'detail': {k: [[list(key), ran, got] for key, ran, got in v]
                                  for k, v in detail.items()}}, fh, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
