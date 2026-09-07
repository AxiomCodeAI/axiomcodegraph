#!/usr/bin/env python3
"""WHAT `--production` COUNTS DECIDES WHAT EVERY CORPUS NUMBER MEANS.

`score.py`'s `TEST_PATH` matched `.test.ts` and did not match `.test-d.ts`, the
`expect-type`/vitest convention for TYPE tests. On the dev corpus member whose type
tests outnumber its source, 11,055 of the 11,818 sites reported as production were test
files — and they score far better than real code, an `expectTypeOf(x).toEqualTypeOf<T>()`
chain being about as easy as a call site gets, so the leak did not dilute the headline
development rate, it RAISED it. Fixed in #276; this pins it. See #280.

TWO PROPERTIES, and the second is the one that keeps a rate meaningful:

  1. the pattern admits a discriminator between the marker and the extension
     (`.test-d.ts`, `.test-prop.ts`, `.spec-x.ts`) WITHOUT swallowing source whose name
     merely contains the word — `latest.ts`, `protest.ts`, `contest-runner.ts`. Five of
     the twelve cases below are that control, because the failure mode of a filter is
     symmetric and over-filtering silently deletes real sites from the measurement.

  2. the filter reaches BOTH SIDES. Dropping test rows from the oracle alone would move
     every surviving IR site into NO_ORACLE_ROW and leave conservation describing a
     population the report no longer scores. `score.py` says so in a comment; this
     asserts it against the running program.

SYNTHESISED INPUTS — no parser, solver, compiler or work directory, so it cannot skip.
"""
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCORE = os.path.normpath(os.path.join(HERE, '..', 'ground-truth', 'score.py'))

checks = 0
failures = []


def ok(msg):
    global checks
    checks += 1
    if os.environ.get('PRODUCTION_FILTER_VERBOSE'):
        print(f'  ok    {msg}')


def bad(msg):
    global checks
    checks += 1
    failures.append(msg)
    print(f'  FAIL  {msg}')


def load_score():
    """score.py guards main() behind __name__, so importing it runs nothing."""
    spec = importlib.util.spec_from_file_location('score_under_test', SCORE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── 1. the pattern itself ───────────────────────────────────────────────────
CASES = [
    # (path, must_be_filtered, why)
    ('src/addProp.test-d.ts',   True,  'the type-test convention #280 is about'),
    ('src/funnel.test-prop.ts', True,  'property tests, same shape'),
    ('src/add.test.ts',         True,  'the plain convention that already worked'),
    ('src/x.spec-x.ts',         True,  'a spec with a discriminator'),
    ('src/x.bench.ts',          True,  'benchmarks'),
    ('src/a.test-d.tsx',        True,  'the tsx variant'),
    ('test/helper.ts',          True,  'a test DIRECTORY — unchanged behaviour'),
    ('src/latest.ts',           False, 'CONTROL: "latest" ends in "test" and is source'),
    ('src/protest.ts',          False, 'CONTROL: "protest" contains "test"'),
    ('src/contest-runner.ts',   False, 'CONTROL: a hyphenated source name'),
    ('src/testing/pipe.ts',     False, 'CONTROL: src/testing is shipped as product'),
    ('src/index.ts',            False, 'CONTROL: ordinary source'),
]


def check_pattern(score):
    for path, want, why in CASES:
        got = score.is_test_path(path)
        if got != want:
            verb = 'was NOT filtered' if want else 'WAS filtered'
            bad(f'{path} {verb} — {why}')
        else:
            ok(f'{path:<26} filtered={got!s:<5} {why}')


# ── 2. both sides, or neither ───────────────────────────────────────────────
def row(width, **cols):
    r = [''] * width
    for i, v in cols.items():
        r[int(i[1:])] = str(v)
    return '\t'.join(r)


def check_both_sides():
    work = tempfile.mkdtemp()
    try:
        ir = os.path.join(work, 'ir')
        out = os.path.join(work, 'out')
        os.makedirs(ir)
        os.makedirs(out)
        tgt = os.path.join(work, 'lib.d.ts')

        # TWO modules: one production, one a type test the old pattern let through.
        with open(os.path.join(ir, 'all-typescript-modules.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(27, c3='filePath', c26='hash') + '\n')
            fh.write(row(27, c3='src/app.ts', c26='MOD_P') + '\n')
            fh.write(row(27, c3='src/app.test-d.ts', c26='MOD_T') + '\n')

        spans = {'S_P': (10, 1, 10, 12), 'S_T': (20, 1, 20, 12)}
        with open(os.path.join(ir, 'all-typescript-expressions.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(34, c33='hash') + '\n')
            for ce, (sl, sc, el, ec) in spans.items():
                fh.write(row(34, c20=sl, c21=sc, c22=el, c23=ec, c33=ce) + '\n')

        with open(os.path.join(ir, 'all-typescript-call-sites.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(7, c5='ce', c6='mod') + '\n')
            fh.write(row(7, c0='FUNCTION_CALL', c1='alpha', c5='S_P', c6='MOD_P') + '\n')
            fh.write(row(7, c0='FUNCTION_CALL', c1='alpha', c5='S_T', c6='MOD_T') + '\n')

        with open(os.path.join(ir, 'all-typescript-methods.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(43, c42='hash') + '\n')
            fh.write(row(43, c0='alpha', c4=tgt, c5=5, c16='FUNCTION_DECLARATION',
                         c39=1, c42='M_A') + '\n')

        with open(os.path.join(out, 'call-chain-edges.csv'), 'w', encoding='utf-8') as fh:
            for ce in spans:
                fh.write('\t'.join([ce, 'C', 'TE', 'M_A', 'p', 'RESOLVED', 'k']) + '\n')

        with open(os.path.join(work, 'oracle.tsv'), 'w', encoding='utf-8') as fh:
            fh.write(row(14, c0='f') + '\n')
            for ce, f in (('S_P', 'src/app.ts'), ('S_T', 'src/app.test-d.ts')):
                sl, sc, el, ec = spans[ce]
                fh.write(row(14, c0=f, c1=sl, c2=sc, c3=el, c4=ec,
                             c7=tgt, c8=5, c9=1, c11='FUNCTION_DECLARATION',
                             c12=1, c13=0) + '\n')

        proc = subprocess.run(
            [sys.executable, SCORE, ir, out, os.path.join(work, 'oracle.tsv'), '--production'],
            capture_output=True, text=True)
        if proc.returncode != 0:
            bad(f'score.py --production exited {proc.returncode}')
            print(proc.stdout[-1500:])
            return
        m = re.search(r'production filter\s+oracle (\d+) -> (\d+)\s+IR (\d+) -> (\d+)',
                      proc.stdout)
        if not m:
            m = re.search(r'production filter\s+oracle (\d+) -> (\d+)\D+(\d+) -> (\d+)',
                          proc.stdout)
        if not m:
            bad('score.py --production printed no both-sides filter line')
            return
        oa, ob, ia, ib = (int(x) for x in m.groups())
        if (oa, ob) != (2, 1):
            bad(f'the ORACLE side kept {ob} of {oa} sites, expected 1 of 2 '
                '(the .test-d.ts row was not filtered)')
        else:
            ok('the type-test site is dropped from the oracle side')
        if (ia, ib) != (2, 1):
            bad(f'the IR side kept {ib} of {ia} sites, expected 1 of 2 — the filter '
                'reached only one side, which is what makes conservation meaningless')
        else:
            ok('the type-test site is dropped from the IR side too')
        # CONTROL: the production site itself must survive on both sides.
        if ob == 1 and ib == 1:
            ok('control: the production site survives on both sides')
    finally:
        shutil.rmtree(work, ignore_errors=True)


score = load_score()
check_pattern(score)
check_both_sides()

if failures:
    print(f'production-filter: FAILED ({checks} checks, {len(failures)} failed)')
    sys.exit(1)
print(f'production-filter: ok ({checks} checks)')
