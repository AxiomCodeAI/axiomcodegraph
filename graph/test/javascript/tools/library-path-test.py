#!/usr/bin/env python3
"""THE SCORER MUST TELL AN IN-PROJECT `.d.ts` FROM THE STANDARD LIBRARY ON EVERY PLATFORM.

`score.py` decided "outside the project" with `startswith('/')`. `tsc-oracle.mjs`
leaves an out-of-project target absolute and unmodified, which on Windows is
`C:/.../node_modules/typescript/lib/lib.es5.d.ts`: no leading slash, so every
standard-library verdict took the in-project branch and became DECL_FILE_TARGET, a
bucket `run-tests.sh` does not gate on. A LIB_WRONG could not fail the run. See #614.

TWO PROPERTIES:

  1. the predicate: absolute on POSIX, absolute on Windows (drive letter, either
     separator), and NOT a relative in-project path, including one whose first
     segment happens to look like a drive (`c/x.d.ts` is a directory named c).

  2. the whole program: fed a Windows-shaped oracle target, `score.py` lands the
     site in LIB_MISSED, and the independent self-check (a DECL_FILE_TARGET under
     node_modules) stays at zero. The paired negative feeds a genuinely in-project
     declaration and expects DECL_FILE_TARGET, so the check cannot pass by routing
     everything into LIB_*.

SYNTHESISED INPUTS: no parser, solver, compiler or work directory, so it cannot skip.
"""
import importlib.util
import os
import re
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
    if os.environ.get('LIBRARY_PATH_VERBOSE'):
        print(f'  ok    {msg}')


def bad(msg):
    global checks
    checks += 1
    failures.append(msg)
    print(f'  FAIL  {msg}')


def load_score():
    spec = importlib.util.spec_from_file_location('score_under_test', SCORE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── 1. the predicate ─────────────────────────────────────────────────────────
CASES = [
    # (path, outside_project, why)
    ('/usr/lib/node_modules/typescript/lib/lib.es5.d.ts', True,  'POSIX standard library'),
    ('C:/proj/node_modules/typescript/lib/lib.es5.d.ts',  True,  'Windows, forward slashes (what the oracle writes)'),
    ('C:\\proj\\node_modules\\typescript\\lib\\lib.dom.d.ts', True, 'Windows, backslashes'),
    ('d:/x/y.d.ts',                                         True,  'lower-case drive letter'),
    ('types/index.d.ts',                                    False, 'CONTROL: in-project declaration'),
    ('lib/p.d.ts',                                          False, 'CONTROL: in-project, first segment "lib"'),
    ('c/x.d.ts',                                            False, 'CONTROL: a directory named c is not a drive'),
    ('C:x.d.ts',                                            False, 'CONTROL: a drive-relative path is not absolute'),
]


def check_predicate(score):
    for path, want, why in CASES:
        got = score.is_outside_project(path)
        if got != want:
            verb = 'was read as IN the project' if want else 'was read as OUTSIDE the project'
            bad(f'{path} {verb}: {why}')
        else:
            ok(f'{path:<52} outside={got!s:<5} {why}')
    src = open(SCORE, encoding='utf-8').read()
    if re.search(r"startswith\('/'\)", src):
        bad("score.py still spells absoluteness as startswith('/')")
    else:
        ok('no leading-slash absoluteness test remains in score.py')


# ── 2. the whole program ────────────────────────────────────────────────────
ORACLE_HEADER = ('callFile\tcallLine\tcallCol\tcallEndLine\tcallEndCol\tcallKind\tcalleeName\t'
                 'targetFile\ttargetLine\ttargetCol\ttargetName\ttargetKind\toverloadCount\t'
                 'chosenIndex\tenclLine\tenclCol\tenclName')


def run_program(target_file):
    """One METHOD_CALL site the engine left unresolved (ambiguous_unknown), whose
    compiler answer is a bodiless `.d.ts` declaration at `target_file`. Returns the
    scorer's bucket for it and its stdout."""
    work = tempfile.mkdtemp()
    ir = os.path.join(work, 'ir')
    out = os.path.join(work, 'out')
    os.makedirs(ir)
    os.makedirs(out)

    def write(name, lines):
        with open(os.path.join(ir, name), 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(lines) + '\n')

    write('all-javascript-modules.csv', [
        'filePath\tjsModuleUniqueHash',
        'main.js\tMOD',
    ])
    write('all-javascript-expressions.csv', [
        'jsExpressionUniqueHash\tstartLine\tstartColumn\tendLine\tendColumn',
        'CE\t7\t37\t7\t60',
    ])
    write('all-javascript-call-sites.csv', [
        'expressionLinkHash\townerModuleLinkHash\tcallKind\tcalleeName',
        'CE\tMOD\tMETHOD_CALL\thasOwnProperty',
    ])
    write('all-javascript-methods.csv', [
        'jsMethodUniqueHash\tfilePath\tstartLine\tstartColumn\tname',
        'M1\tmain.js\t3\t1\tmain',
    ])
    with open(os.path.join(out, 'call-chain-edges.csv'), 'w', encoding='utf-8') as fh:
        fh.write('\t'.join(['CE', 'M1', '-', '-', '-', 'ambiguous_unknown', 'METHOD_CALL']) + '\n')
    oracle = os.path.join(work, 'oracle.tsv')
    with open(oracle, 'w', encoding='utf-8') as fh:
        fh.write(ORACLE_HEADER + '\n')
        fh.write('\t'.join(['main.js', '7', '37', '7', '60', 'METHOD_CALL', 'hasOwnProperty',
                            target_file, '120', '5', 'hasOwnProperty', 'bodiless', '1', '0',
                            '7', '1', 'main']) + '\n')
    dump = os.path.join(work, 'rows.tsv')
    proc = subprocess.run([sys.executable, SCORE, ir, out, oracle, f'--dump={dump}'],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        return f'score.py exited {proc.returncode}: {proc.stderr.strip()}', proc.stdout
    with open(dump, encoding='utf-8') as fh:
        rows = [l.rstrip('\n').split('\t') for l in fh if l.strip()]
    # dump columns: file line col endLine endCol callKind callee oracleKind bucket ...
    buckets = [r[8] for r in rows[1:] if len(r) > 8 and r[0] == 'main.js']
    return (buckets[0] if buckets else 'NO ROW'), proc.stdout


def check_program():
    windows_lib = 'C:/Users/dev/proj/node_modules/typescript/lib/lib.es5.d.ts'
    bucket, stdout = run_program(windows_lib)
    if bucket != 'LIB_MISSED':
        bad(f'a Windows standard-library target scored {bucket}, expected LIB_MISSED')
    else:
        ok('a Windows standard-library target scores LIB_MISSED')
    if 'SCORER_SELF_CHECK' in stdout:
        bad('the self-check fired on a correctly bucketed run')
    else:
        ok('the self-check stays silent when the bucket is right')

    posix_lib = '/usr/local/lib/node_modules/typescript/lib/lib.es5.d.ts'
    bucket, _ = run_program(posix_lib)
    if bucket != 'LIB_MISSED':
        bad(f'a POSIX standard-library target scored {bucket}, expected LIB_MISSED (regression)')
    else:
        ok('a POSIX standard-library target still scores LIB_MISSED')

    # The paired negative: an in-project declaration must NOT be routed to LIB_*.
    bucket, _ = run_program('types/index.d.ts')
    if bucket != 'DECL_FILE_TARGET':
        bad(f'an in-project .d.ts target scored {bucket}, expected DECL_FILE_TARGET')
    else:
        ok('an in-project .d.ts target scores DECL_FILE_TARGET')


def main():
    score = load_score()
    check_predicate(score)
    check_program()
    if failures:
        print(f'library-path: FAILED ({checks} checks, {len(failures)} failed)')
        sys.exit(1)
    print(f'library-path: ok ({checks} checks)')


if __name__ == '__main__':
    main()
