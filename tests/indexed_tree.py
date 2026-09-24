#!/usr/bin/env python3
"""tests/indexed_tree.py — `changed` compares against the tree the graph was indexed from (#1222).

The graph's spans are line numbers in the working tree as it was when indexed, and that tree need not be the commit in
the stamp: uncommitted edits are indexed too. `changed` compared the working tree against the COMMIT, so after an index
taken with edits every position was off, and a span past the end of the committed file crashed changed and test-impact.

Each run builds a real graph in a throwaway git repository: commit, edit without committing, index, edit again, then
asks `changed` what moved. Only the second edit may be reported, positions must be the indexed ones, and the user's
own git index must be untouched by the build.

    python3 tests/indexed_tree.py
"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')

COMMITTED = '''export function a(): number {
  return 1
}

export function b(): number {
  return 2
}
'''
# uncommitted when the graph is built: a type alias above `a` pushes every later declaration down four lines
INDEXED = '''export type Options = {
  mode: 'strict' | 'loose'
}

export function a(options: Options): number {
  return options.mode === 'strict' ? 1 : 0
}

export function b(): number {
  return 2
}
'''
# the edit after indexing: only b's body
AFTER = INDEXED.replace('return 2', 'return 20')


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def main():
    fails = []
    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok else '\n     ' + detail.strip().replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = tempfile.mkdtemp(prefix='axiomcode-indexed-tree-')
    try:
        repo = os.path.join(work, 'repo'); os.makedirs(os.path.join(repo, 'src'))
        f = os.path.join(repo, 'src', 'app.ts')
        open(f, 'w').write(COMMITTED)
        open(os.path.join(repo, 'tsconfig.json'), 'w').write('{ "compilerOptions": { "strict": true }, "include": ["src"] }\n')
        for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'),
                    ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
            sh(repo, *cmd)
        open(f, 'w').write(INDEXED)
        before = sh(repo, 'git', 'status', '--porcelain').stdout
        env = dict(os.environ, AXIOMCODE_ENGINE=ROOT)
        built = sh(repo, AX, 'index', '.', '--lang', 'typescript', env=env)
        check(built.returncode == 0, 'the graph builds from a working tree with uncommitted edits', built.stdout + built.stderr)
        after = sh(repo, 'git', 'status', '--porcelain').stdout
        check(before == after, "the build does not touch the user's git index or working tree", f'before:\n{before}\nafter:\n{after}')
        tree_file = os.path.join(repo, '.axiomcode', 'out', 'indexed-tree')
        check(os.path.exists(tree_file), 'the build records the tree it indexed')

        open(f, 'w').write(AFTER)
        r = sh(repo, AX, 'changed', '.', env=env)
        out = r.stdout + r.stderr
        check(r.returncode == 0 and 'Traceback' not in out, 'changed answers, no crash', out)
        check('body       b   src/app.ts:9' in out, "the edit after indexing is reported, at the indexed position (b starts at line 9)", out)
        rows = [l.split() for l in out.split('\n') if l.startswith('  ') and len(l.split()) >= 2]
        names = {r[1] for r in rows}
        check(names == {'b'}, 'the edits that were already indexed are not reported as changes: only b', out)
        check('indexed from' in out, 'the answer says it compares against the indexed tree, not the commit', out)
        check('run past the end' not in out, 'no misaligned-span warning: the positions line up', out)
        ti = sh(repo, AX, 'test-impact', '.', env=env)
        check(ti.returncode == 0 and 'Traceback' not in ti.stdout + ti.stderr, 'test-impact answers too', ti.stdout + ti.stderr)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'ok' if not fails else f'{len(fails)} FAILED'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
