#!/usr/bin/env python3
"""A ROOT THE FILESYSTEM DOES NOT HAVE IS NOT A ROOT.

`.source-root` is written by the shell and read verbatim by the Python scorers. Where
the shell's path form is not one the Python runtime resolves, `os.path.realpath` does
NOT fail — it returns a different, NONEXISTENT absolute path. Every staged declaration
is then keyed under that path, the join with the oracle's absolute targets produces the
empty set, and the run reports:

    TARGET NOT STAGED   104   85.95% of scored sites name a declaration in a file
                              nothing staged

naming the client's OWN source files as unstaged, with a verdict of EXACT 0 / WRONG 93.
The same artefacts with a resolvable root score EXACT 88 (0.846) / WRONG 0. So the
failure mode is not a crash and not a zero — it is a plausible-looking report about
nothing, and the only safe answer is to refuse. See #342.

The control matters as much as the assertion: a guard that refused whenever it felt
uncertain would pass the positive check and make every ordinary run unscoreable.

SYNTHESISED INPUTS, shared with envelope_report_test — no parser, no solver, no
compiler, no work directory, so this cannot skip and cannot decay when a fixture moves.
"""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCORE = os.path.join(HERE, '..', 'ground-truth', 'score.py')

_spec = importlib.util.spec_from_file_location(
    'envelope_report_test', os.path.join(HERE, 'envelope_report_test.py'))
_fixture = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fixture)

checks = 0
failures = []


def ok(msg):
    global checks
    checks += 1
    print(f'  ok    {msg}')


def bad(msg):
    global checks
    checks += 1
    failures.append(msg)
    print(f'  FAIL  {msg}')


def score(ir, out, work):
    return subprocess.run(
        [sys.executable, SCORE, ir, out, os.path.join(work, 'oracle.tsv')],
        capture_output=True, text=True)


def main():
    work = tempfile.mkdtemp()
    try:
        ir, out = _fixture.build(work)
        marker = os.path.join(ir, '.source-root')

        # 1. A RECORDED ROOT THAT DOES NOT EXIST REFUSES. This is the shape a shell-form
        #    path takes after realpath: absolute, plausible, and not a directory.
        with open(marker, 'w', encoding='utf-8') as fh:
            fh.write(os.path.join(work, 'no-such-root-here') + '\n')
        proc = score(ir, out, work)
        if 'REFUSING to report' not in proc.stdout:
            bad('a .source-root naming a nonexistent directory was accepted and scored')
        else:
            ok('a .source-root naming a nonexistent directory refuses')

        # 2. AND WITH A NON-ZERO STATUS, so a caller under `set -e` stops. run-evaluation
        #    checks score.py's status and calls the run "NOT a measurement"; a refusal
        #    that exits 0 would be printed and then ignored by every automated reader.
        if proc.returncode == 0:
            bad('the refusal exited 0, so a caller would treat the run as a measurement')
        else:
            ok(f'the refusal exits non-zero ({proc.returncode})')

        # 3. THE REPORT NAMES THE ROOT AND WHAT IT RESOLVED TO. A refusal that does not
        #    say which root is wrong sends the reader to the buckets, which is where this
        #    defect already sends them.
        if 'no-such-root-here' not in proc.stdout:
            bad('the refusal does not name the offending root')
        else:
            ok('the refusal names the offending root and what it resolved to')

        # 4. CONTROL — A ROOT THAT EXISTS IS SCORED NORMALLY. The guard must fire on the
        #    filesystem's answer and nothing else; one that fired on any root at all
        #    would satisfy checks 1 to 3 and score nothing ever again.
        with open(marker, 'w', encoding='utf-8') as fh:
            fh.write(work + '\n')
        proc2 = score(ir, out, work)
        if 'REFUSING to report' in proc2.stdout:
            bad('CONTROL: a .source-root naming a real directory was refused')
        elif proc2.returncode != 0:
            bad(f'CONTROL: a valid root exited {proc2.returncode}')
        else:
            ok('control: a .source-root naming a real directory is scored normally')

        # 5. CONTROL — NO MARKER AT ALL is the pre-existing weak-root path, which warns
        #    and scores. It must not be turned into a refusal: an IR root with no marker
        #    is a known, reported looseness, not a broken join.
        os.remove(marker)
        proc3 = score(ir, out, work)
        if 'REFUSING to report' in proc3.stdout:
            bad('CONTROL: a missing .source-root was refused rather than reported as weak')
        elif proc3.returncode != 0:
            bad(f'CONTROL: a missing .source-root exited {proc3.returncode}')
        else:
            ok('control: a missing .source-root still warns and scores, as before')
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
    if failures:
        print(f'source-root: FAILED ({checks} checks, {len(failures)} failed)')
        sys.exit(1)
    print(f'source-root: ok ({checks} checks)')
