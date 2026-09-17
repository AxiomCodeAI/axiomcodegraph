#!/usr/bin/env python3
"""ONE CALL SITE IS ONE ORACLE ROW, WHATEVER THE ROOT IS SPELLED LIKE.

`tsc-oracle.mjs` walked the root exactly as given and let the compiler resolve
imports. A workspace import goes through `node_modules/@scope/pkg -> ../../packages/pkg`,
and TypeScript resolves a package found under `node_modules` to its REAL path, so with a
root reached through a symlink (macOS `/tmp`, a symlinked checkout, a container bind
mount) the same file was a ROOT file under one spelling and an IMPORTED file under the
other. The program held two source files for it, both passed the realpath'd root-set
test, and both relativised to one site key — so every call site inside a workspace-linked
package was emitted TWICE. `score.py` then scored an inflated population: on one corpus
workspace 20,064 keys doubled, decided 10,144 rather than 5,219, with the rates still
looking plausible. See #794.

TWO PROPERTIES:

  1. the oracle: a workspace fixture read through a symlinked root and through the
     canonical one produces byte-identical output, and neither repeats a site key. The
     fixture has a call site INSIDE the linked package, which is the row that doubled;
     a fixture without one cannot fail and would prove nothing.

  2. the scorer's guard: fed an oracle that repeats a site key, `score.py` reports it on
     a SCORER_SELF_CHECK line, so any future cause of a doubled population is caught
     whatever it is. The paired negative feeds the same oracle without the repeat and
     expects silence, so the guard cannot pass by always firing.

Property 2 synthesises its inputs and cannot skip. Property 1 needs node and a resolvable
typescript, and skips (loudly) without them, as the oracle itself does.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCORE = os.path.normpath(os.path.join(HERE, '..', 'ground-truth', 'score.py'))
ORACLE = os.path.normpath(os.path.join(HERE, '..', 'ground-truth', 'tsc-oracle.mjs'))

checks = 0
failures = []
skipped = []


def ok(msg):
    global checks
    checks += 1
    if os.environ.get('ORACLE_SYMLINK_VERBOSE'):
        print(f'  ok    {msg}')


def bad(msg):
    global checks
    checks += 1
    failures.append(msg)
    print(f'  FAIL  {msg}')


# ── 1. the oracle, both spellings of one root ────────────────────────────────
# `packages/util` is linked into node_modules the way npm, yarn and pnpm link a
# workspace package. `helper` CALLS `inner` in the same file: that call site is inside
# the linked package and is the one that was emitted twice.
FIXTURE = {
    'ws/package.json': '{ "name": "ws", "private": true, "workspaces": ["packages/*"] }',
    'ws/packages/util/package.json': '{ "name": "@ws/util", "type": "module", "main": "index.js" }',
    'ws/packages/util/index.js': 'export function helper(x) { return inner(x); }\n'
                                 'function inner(x) { return x + 1; }\n',
    'ws/packages/app/package.json': '{ "name": "@ws/app", "type": "module", "main": "src/main.js" }',
    'ws/packages/app/src/main.js': "import { helper } from '@ws/util';\n"
                                   'export function run(x) { return helper(x); }\n',
}


def build_fixture(root):
    for rel, text in FIXTURE.items():
        target = os.path.join(root, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'w', encoding='utf-8') as fh:
            fh.write(text)
    link_dir = os.path.join(root, 'ws', 'node_modules', '@ws')
    os.makedirs(link_dir, exist_ok=True)
    os.symlink(os.path.join('..', '..', 'packages', 'util'), os.path.join(link_dir, 'util'))


def site_keys(tsv_path):
    with open(tsv_path, encoding='utf-8') as fh:
        rows = [l.rstrip('\n').split('\t') for l in fh if l.strip()]
    return [tuple(r[:5]) for r in rows[1:]]


def check_oracle():
    if shutil.which('node') is None:
        skipped.append('node not on PATH')
        return
    work = tempfile.mkdtemp()
    try:
        # `real/` holds the tree; `link/` is a second spelling of the same directory, so
        # the two roots differ only in how the path is written. This is what macOS's
        # /tmp -> /private/tmp does to every run launched from a temp directory.
        real = os.path.join(work, 'real')
        os.makedirs(real)
        build_fixture(real)
        os.symlink(real, os.path.join(work, 'link'))

        outputs = {}
        for spelling in ('real', 'link'):
            root = os.path.join(work, spelling, 'ws')
            out = os.path.join(work, f'oracle-{spelling}.tsv')
            proc = subprocess.run([shutil.which('node'), ORACLE, root, out],
                                  capture_output=True, text=True)
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout).strip().splitlines()
                first = detail[0] if detail else f'exit {proc.returncode}'
                if 'typescript' in first.lower():
                    skipped.append(f'tsc-oracle could not load typescript ({first})')
                    return
                bad(f'tsc-oracle failed on the {spelling} root: {first}')
                return
            outputs[spelling] = out

        keys = {s: site_keys(p) for s, p in outputs.items()}
        # The control: without a site inside the linked package there is nothing to
        # double, and the check would pass against the unfixed oracle too.
        if not any(k[0].startswith('packages/util/') for k in keys['real']):
            bad('the fixture emitted no site inside the linked package, so it cannot detect the defect')
            return
        ok('the fixture emits a call site inside the workspace-linked package')

        for spelling, ks in keys.items():
            repeats = {k for k in ks if ks.count(k) > 1}
            if repeats:
                bad(f'the {spelling} root emitted {len(repeats)} site key(s) twice, '
                    f'e.g. {sorted(repeats)[0]}')
            else:
                ok(f'the {spelling} root emits every site key once')

        with open(outputs['real'], encoding='utf-8') as fh:
            a = fh.read()
        with open(outputs['link'], encoding='utf-8') as fh:
            b = fh.read()
        if a != b:
            bad(f'the two spellings of one root disagree: {len(keys["real"])} rows canonical, '
                f'{len(keys["link"])} rows symlinked')
        else:
            ok('both spellings of the root produce identical oracle output')

        src = open(ORACLE, encoding='utf-8').read()
        if not re.search(r'realpathSync\(given\)', src):
            bad('tsc-oracle.mjs no longer canonicalises the root it was given')
        else:
            ok('tsc-oracle.mjs canonicalises the root before walking it')
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── 2. the scorer's guard ────────────────────────────────────────────────────
ORACLE_HEADER = ('callFile\tcallLine\tcallCol\tcallEndLine\tcallEndCol\tcallKind\tcalleeName\t'
                 'targetFile\ttargetLine\ttargetCol\ttargetName\ttargetKind\toverloadCount\t'
                 'chosenIndex\tenclLine\tenclCol\tenclName')
ORACLE_ROW = ['main.js', '7', '37', '7', '60', 'FUNCTION_CALL', 'helper',
              'main.js', '3', '1', 'helper', 'function', '1', '0', '7', '1', 'main']


def run_scorer(duplicate):
    """One resolved FUNCTION_CALL site the engine got right, emitted once or twice."""
    work = tempfile.mkdtemp()
    try:
        ir = os.path.join(work, 'ir')
        out = os.path.join(work, 'out')
        os.makedirs(ir)
        os.makedirs(out)

        def write(name, lines):
            with open(os.path.join(ir, name), 'w', encoding='utf-8') as fh:
                fh.write('\n'.join(lines) + '\n')

        write('all-javascript-modules.csv', ['filePath\tjsModuleUniqueHash', 'main.js\tMOD'])
        write('all-javascript-expressions.csv',
              ['jsExpressionUniqueHash\tstartLine\tstartColumn\tendLine\tendColumn',
               'CE\t7\t37\t7\t60'])
        write('all-javascript-call-sites.csv',
              ['expressionLinkHash\townerModuleLinkHash\tcallKind\tcalleeName',
               'CE\tMOD\tFUNCTION_CALL\thelper'])
        write('all-javascript-methods.csv',
              ['jsMethodUniqueHash\tfilePath\tstartLine\tstartColumn\tname',
               'M1\tmain.js\t3\t1\thelper'])
        with open(os.path.join(out, 'call-chain-edges.csv'), 'w', encoding='utf-8') as fh:
            fh.write('\t'.join(['CE', 'M1', 'M1', '-', 'client', 'known_edge', 'FUNCTION_CALL']) + '\n')
        oracle = os.path.join(work, 'oracle.tsv')
        with open(oracle, 'w', encoding='utf-8') as fh:
            fh.write(ORACLE_HEADER + '\n')
            fh.write('\t'.join(ORACLE_ROW) + '\n')
            if duplicate:
                fh.write('\t'.join(ORACLE_ROW) + '\n')
        proc = subprocess.run([sys.executable, SCORE, ir, out, oracle],
                              capture_output=True, text=True)
        return proc.stdout + proc.stderr
    finally:
        shutil.rmtree(work, ignore_errors=True)


def check_guard():
    doubled = run_scorer(duplicate=True)
    line = [l for l in doubled.splitlines() if 'SCORER_SELF_CHECK' in l and '#794' in l]
    if not line:
        bad('an oracle repeating a site key produced no SCORER_SELF_CHECK line')
    else:
        ok('a repeated oracle site key is reported on a SCORER_SELF_CHECK line')

    clean = run_scorer(duplicate=False)
    if any('#794' in l for l in clean.splitlines() if 'SCORER_SELF_CHECK' in l):
        bad('the duplicate-key self-check fired on an oracle with no repeated key')
    else:
        ok('the duplicate-key self-check stays silent on a clean oracle')
    # The paired positive control: the clean run must still SCORE the site, or the
    # check above would pass on a scorer that dropped every row.
    if 'client->client decided by the compiler: 1' not in clean:
        bad('the clean run did not decide its one site, so the silence above proves nothing')
    else:
        ok('the clean run still decides its one site')


def main():
    check_oracle()
    check_guard()
    for why in skipped:
        print(f'  SKIP  property 1 (the oracle): {why}')
    if failures:
        print(f'oracle-symlink: FAILED ({checks} checks, {len(failures)} failed)')
        sys.exit(1)
    print(f'oracle-symlink: ok ({checks} checks)')


if __name__ == '__main__':
    main()
