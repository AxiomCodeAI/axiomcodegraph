#!/usr/bin/env python3
"""tests/refresh_races.py — a query during a rebuild, a rebuild that fails, and what the index reads, after an edit.

Each check lays out a throwaway git repository with a real graph (so it needs the engine, as tests/refresh.py), then
provokes one of the states a refresh after an edit can leave behind, and asks what a user would ask next. Every check
has a CONTROL: the nearby case that must keep behaving as it did.

  broken pointer      graph.sqlite points at nothing (a build interrupted between moves). The refresher still runs
                      (it used to take this for "no graph" and stop for good), a query repairs the graph instead of
                      failing, and the repair KEEPS the baseline `changed` measures against: an edit made before it is
                      still reported, as a body change. Control: a first index still sets the baseline to what it read.
  query mid-build     a query that finds no graph while a build holds the lock waits for that build, with a progress
                      line, and answers from its graph; it starts no build of its own. Control: with no build running,
                      a query does not wait.
  failed swap         a build whose main language changed fails: graph.sqlite still points at a graph (the previous
                      one) and impact answers. Control: a failed build with the same main language puts that
                      language's directory back and leaves no stray link.
  failure reason      a background refresh that fails says WHY in the note a query prints, not only "see build.log".
  copied checkout     graph.sqlite points at its graph by a relative name, so a copy reads its own graph and sees its
                      own edits (#1605). An absolute pointer an older build left, into another checkout that is still
                      there or gone, is re-pointed at the copy's graph and said as such, never "a build was
                      interrupted". Controls: the original does not see the copy's edit; an absolute pointer into
                      its own graph is kept silently.
  gitignore           the index and the refresher skip what git ignores: a generated tree .gitignore names is neither
                      parsed nor watched. Controls: a tracked file under an ignored name is read; AXIOMCODE_NO_GITIGNORE=1
                      reads everything.
  no rules            with no compiled rules and no soufflé, impact answers from its SQL port (the same answer) and says
                      so; the advice names this OS's fix, not Homebrew on Windows. Control: with the rules, no notice.

    python3 tests/refresh_races.py [-v]
"""
import fcntl, json, os, shutil, sqlite3, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
FRESH = os.path.join(SCRIPTS, 'ax_fresh.py')

UTIL = ('export function helper(): number {\n  return 1\n}\n\n'
        'export function caller(): number {\n  return helper()\n}\n\n'
        'export function other(): number {\n  return helper()\n}\n')
TSCONFIG = '{ "compilerOptions": { "strict": true }, "include": ["src", "keepdir"] }\n'


def sh(cwd, *cmd, env=None, timeout=900):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env, timeout=timeout)


def repo_with(work, name, files, ignored=None, force=()):
    repo = os.path.join(work, name)
    for rel, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(repo, rel)), exist_ok=True)
        open(os.path.join(repo, rel), 'w').write(text)
    if ignored: open(os.path.join(repo, '.gitignore'), 'w').write(ignored)
    sh(repo, 'git', 'init', '-q'); sh(repo, 'git', 'add', '-A')
    for f in force: sh(repo, 'git', 'add', '-f', f)
    sh(repo, 'git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')
    return repo


def changed_kinds(repo, env):
    j = json.loads(sh(repo, AX, 'changed', '.', '--json', env=env).stdout or '{}')
    return sorted((c['kind'], c['symbol']) for c in j.get('changed', [])), j.get('notes', [])


def main(argv):
    verbose = '-v' in argv
    fails = []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok or not (detail or '').strip() else '\n     ' + detail.strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    env = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_REFRESH_DEBOUNCE='0.3', AXIOMCODE_FRESH_WAIT='120')
    quiet = dict(env, AXIOMCODE_NO_REFRESH='1')
    work = tempfile.mkdtemp(prefix='axiomcode-races-')
    try:
        # ── broken pointer ────────────────────────────────────────────────────────────────────────────────────
        repo = repo_with(work, 'broken', {'tsconfig.json': TSCONFIG, 'src/util.ts': UTIL})
        out = os.path.join(repo, '.axiomcode', 'out'); ptr = os.path.join(out, 'graph.sqlite')
        b = sh(repo, AX, 'index', '.', env=env)
        check(b.returncode == 0, 'broken pointer: the graph builds', b.stdout + b.stderr)
        base0 = open(os.path.join(out, 'base-tree')).read().strip()
        check(base0 == sh(repo, 'git', 'rev-parse', 'HEAD^{tree}').stdout.strip(),
              'control: a first index sets the baseline to the tree it read')
        f = os.path.join(repo, 'src', 'util.ts')
        text = open(f).read()
        open(f, 'w').write(text.replace('  return helper()\n}\n\nexport function other',
                                        '  const a = 1\n  const b = a + 1\n  return helper() + b\n}\n\nexport function other'))
        k0, _ = changed_kinds(repo, quiet)
        check(('body', 'caller') in k0, 'broken pointer: before anything breaks, lines added inside caller are a body change', str(k0))
        target = os.path.realpath(ptr)
        os.remove(ptr); os.symlink(os.path.join(out, 'nowhere', 'graph.sqlite'), ptr)          # an interrupted swap
        st = json.loads(sh(repo, 'python3', FRESH, 'status', repo, '--json', env=env).stdout or '{}')
        check(st.get('state') in ('stale', 'building'), 'broken pointer: the refresher sees a graph to repair, not "no graph"', json.dumps(st))
        r = sh(repo, AX, 'impact', 'helper', '.', env=env)
        check(r.returncode == 0 and 'caller' in r.stdout and 'Traceback' not in r.stderr,
              'broken pointer: a query answers (the graph is repaired) instead of failing', r.stdout[-800:] + r.stderr[-800:])
        check(os.path.exists(ptr), 'broken pointer: graph.sqlite points at a graph again')
        check(open(os.path.join(out, 'base-tree')).read().strip() == base0,
              'broken pointer: the repair keeps the baseline `changed` measures against', open(os.path.join(out, 'base-tree')).read())
        k1, n1 = changed_kinds(repo, quiet)
        check(k1 == k0, 'broken pointer: after the repair, the earlier edit is still reported, still as a body change', f'before {k0}\nafter  {k1} {n1}')

        # ── query mid-build ───────────────────────────────────────────────────────────────────────────────────
        lock = os.path.join(repo, '.axiomcode', 'build.lock')
        # the repair above answered as soon as its graph was published (#1555) and may still be solving: it ends first,
        # or it re-points graph.sqlite under the lock this check holds
        fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o644); fcntl.flock(fd, fcntl.LOCK_EX); fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)
        good = os.path.realpath(ptr); os.remove(ptr)
        held = threading.Event()

        def hold():
            fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o644); fcntl.flock(fd, fcntl.LOCK_EX); held.set()
            try: time.sleep(3); os.symlink(good, ptr)
            finally: fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)      # never left held: every later build would wait on it
        t = threading.Thread(target=hold); t.start(); held.wait()
        logm = os.path.getmtime(os.path.join(repo, '.axiomcode', 'build.log'))
        t0 = time.time(); r = sh(repo, AX, 'impact', 'helper', '.', env=dict(env, AXIOMCODE_NO_REFRESH='1')); took = time.time() - t0
        t.join()
        check(r.returncode == 0 and 'caller' in r.stdout and ('a graph build is running' in r.stderr or 'a graph build is already running' in r.stderr),
              f'query mid-build: a query that finds no graph while a build runs waits for it, says so, and answers ({took:.1f}s)',
              r.stdout[-600:] + r.stderr[-600:])
        check(os.path.getmtime(os.path.join(repo, '.axiomcode', 'build.log')) == logm, 'query mid-build: and starts no build of its own')
        t0 = time.time(); r = sh(repo, AX, 'impact', 'helper', '.', env=quiet); took = time.time() - t0
        check(r.returncode == 0 and 'a graph build is running' not in r.stderr and took < 30,
              f'control: with no build running a query does not wait ({took:.1f}s)', r.stderr[-400:])

        # ── failure reason, failed swap ───────────────────────────────────────────────────────────────────────
        stub = os.path.join(work, 'stub-engine')
        for d in ('bin', 'graph', 'parser/dist'): os.makedirs(os.path.join(stub, d))
        open(os.path.join(stub, 'package.json'), 'w').write('{}'); open(os.path.join(stub, 'parser', 'dist', 'index.js'), 'w').close()
        open(os.path.join(stub, 'bin', 'axiomcode'), 'w').write('#!/bin/sh\necho "❌ parser failed — stub engine"\nexit 1\n')
        os.chmod(os.path.join(stub, 'bin', 'axiomcode'), 0o755)
        open(f, 'a').write('\nexport function more(): number {\n  return 3\n}\n')
        w = sh(repo, 'python3', FRESH, 'worker', repo, env=dict(env, AXIOMCODE_ENGINE=stub))
        s = sh(repo, 'python3', FRESH, 'status', repo, env=quiet).stdout
        check('FAILED' in s and 'build failed' in s and 'refresh.log' in s,
              'failure reason: a failed refresh says why in the note, and where its output is', s + w.stdout)
        check(os.path.exists(ptr), 'failure reason: and the previous graph still answers')

        mixed = repo_with(work, 'mixed', {'tsconfig.json': TSCONFIG, 'src/util.ts': UTIL, 'pkg/__init__.py': '', 'pkg/m.py': 'def h():\n    return 1\n'})
        mout = os.path.join(mixed, '.axiomcode', 'out'); mptr = os.path.join(mout, 'graph.sqlite')
        b = sh(mixed, AX, 'index', '.', '--lang', 'typescript,python', env=env)
        check(b.returncode == 0 and os.path.realpath(mptr).endswith('/typescript/graph.sqlite'), 'failed swap: a two-language graph builds, typescript main', b.stdout + b.stderr)
        # the main language changes (python first) and the build fails
        r = sh(mixed, 'bash', os.path.join(SCRIPTS, 'axiomcode-build'), mixed, env=dict(env, AXIOMCODE_ENGINE=stub, AXIOMCODE_LANG='python,typescript'))
        check(r.returncode != 0, 'failed swap: the stub build fails', r.stdout)
        check(os.path.exists(mptr), 'failed swap: graph.sqlite still points at a graph after a failed build whose main language changed',
              f"{mptr} -> {os.readlink(mptr) if os.path.islink(mptr) else '?'}")
        q = sh(mixed, AX, 'impact', 'helper', '.', env=quiet)
        check(q.returncode == 0 and 'caller' in q.stdout, 'failed swap: and impact answers from it', q.stdout[-500:] + q.stderr[-500:])
        # control: same main language, failed: the language's directory comes back and no stray link is left
        open(os.path.join(mixed, 'src', 'util.ts'), 'a').write('\n// rebuilt\n')
        b = sh(mixed, AX, 'index', '.', '--lang', 'typescript,python', env=env)
        check(b.returncode == 0 and os.path.realpath(mptr) == os.path.join(os.path.realpath(mout), 'typescript', 'graph.sqlite')
              and not os.path.exists(os.path.join(mout, '.live.sqlite')), 'failed swap: the next good build points at its own graph again, no stray link', b.stdout[-400:])
        open(os.path.join(mixed, 'src', 'util.ts'), 'a').write('\n// touched\n')
        r = sh(mixed, 'bash', os.path.join(SCRIPTS, 'axiomcode-build'), mixed, env=dict(env, AXIOMCODE_ENGINE=stub, AXIOMCODE_LANG='typescript,python'))
        check(r.returncode != 0 and os.path.realpath(mptr) == os.path.join(os.path.realpath(mout), 'typescript', 'graph.sqlite')
              and not os.path.exists(os.path.join(mout, '.live.sqlite')),
              'control: a failed build with the same main language puts its directory back, with no stray link',
              f"{os.path.realpath(mptr)} live={os.path.exists(os.path.join(mout, '.live.sqlite'))}")

        # ── copied checkout ───────────────────────────────────────────────────────────────────────────────────
        orig = repo_with(work, 'orig', {'tsconfig.json': TSCONFIG, 'src/util.ts': UTIL})
        b = sh(orig, AX, 'index', '.', env=env)
        optr = os.path.join(orig, '.axiomcode', 'out', 'graph.sqlite')
        check(b.returncode == 0 and os.path.islink(optr) and not os.path.isabs(os.readlink(optr)),
              'copied checkout: graph.sqlite points at its graph by a name relative to its directory', f"{os.readlink(optr) if os.path.islink(optr) else '?'}\n{b.stdout[-400:]}")
        cp = os.path.join(work, 'copy'); shutil.copytree(orig, cp, symlinks=True)
        cptr = os.path.join(cp, '.axiomcode', 'out', 'graph.sqlite')
        open(os.path.join(cp, 'src', 'util.ts'), 'a').write('\nexport function third(): number {\n  return helper()\n}\n')
        check(os.path.realpath(cptr).startswith(os.path.realpath(cp) + os.sep), 'copied checkout: the copy reads its own graph', os.path.realpath(cptr))
        b = sh(cp, AX, 'index', '.', env=env)
        r = sh(cp, AX, 'impact', 'helper', '.', env=quiet)
        check(b.returncode == 0 and r.returncode == 0 and 'third' in r.stdout and os.path.realpath(cptr).startswith(os.path.realpath(cp) + os.sep),
              'copied checkout: the copy rebuilds its own graph and sees its own edit', b.stdout[-400:] + r.stdout[-600:] + r.stderr[-600:])
        r = sh(orig, AX, 'impact', 'helper', '.', env=quiet)
        check(r.returncode == 0 and 'third' not in r.stdout and 'caller' in r.stdout, 'control: the original does not see the copy\'s edit', r.stdout[-400:])
        # a pointer an older build left: absolute, into the original, whether the original is still there or gone
        leg = os.path.join(work, 'legacy'); shutil.copytree(orig, leg, symlinks=True)
        lptr = os.path.join(leg, '.axiomcode', 'out', 'graph.sqlite'); logp = os.path.join(leg, '.axiomcode', 'build.log')
        for case, target in (('the original still there', os.path.realpath(optr)),
                             ('the original moved away', os.path.join(work, 'gone', '.axiomcode', 'out', 'typescript', 'graph.sqlite'))):
            os.remove(lptr); os.symlink(target, lptr); logm = os.path.getmtime(logp)
            r = sh(leg, AX, 'impact', 'helper', '.', env=quiet)
            check(r.returncode == 0 and 'caller' in r.stdout and "another checkout's graph" in r.stderr and 're-pointed at its own graph' in r.stderr
                  and 'interrupted' not in r.stderr and os.readlink(lptr) == 'typescript/graph.sqlite' and os.path.getmtime(logp) == logm,
                  f'copied checkout: an absolute pointer into another checkout ({case}) is re-pointed at this one\'s graph, said as such, with no rebuild',
                  f"{os.readlink(lptr)}\n" + r.stdout[-400:] + r.stderr[-600:])
        # control: an absolute pointer into this checkout's own out/ is its graph, re-pointed without a word
        os.remove(lptr); os.symlink(os.path.join(os.path.realpath(leg), '.axiomcode', 'out', 'typescript', 'graph.sqlite'), lptr)
        r = sh(leg, AX, 'impact', 'helper', '.', env=quiet)
        check(r.returncode == 0 and 'caller' in r.stdout and 'another checkout' not in r.stderr and os.readlink(lptr) == 'typescript/graph.sqlite',
              'control: an older absolute pointer into its own graph is kept, relative, silently', r.stderr[-400:])

        # ── gitignore ─────────────────────────────────────────────────────────────────────────────────────────
        gen = {f'gen/deep/g{i}.ts': f'export function gen{i}(): number {{\n  return {i}\n}}\n' for i in range(200)}
        gi = repo_with(work, 'gitignore', dict({'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n', 'src/util.ts': UTIL,
                                               'keepdir/kept.ts': 'export function kept(): number {\n  return 2\n}\n'}, **gen),
                       ignored='gen/\nkeepdir/\n', force=('keepdir/kept.ts',))
        t0 = time.time(); b = sh(gi, AX, 'index', '.', env=env); took = time.time() - t0
        files = lambda r: {x[0] for x in sqlite3.connect(os.path.join(r, '.axiomcode', 'out', 'graph.sqlite')).execute('SELECT DISTINCT file FROM symbols')}
        fs = files(gi)
        check(b.returncode == 0 and not any(x.startswith('gen/') for x in fs), f'gitignore: a directory .gitignore names is not parsed ({took:.1f}s)', b.stdout[-600:] + str(sorted(fs))[:600])
        check('typescript 2 ' in b.stdout, 'gitignore: nor counted when the language is chosen', b.stdout[:400])
        check(any(x.startswith('keepdir/') for x in fs), 'control: a tracked file under an ignored name is still read', str(sorted(fs)))
        table = json.load(open(os.path.join(gi, '.axiomcode', 'out', 'files.json')))['files']
        check(not any(x.startswith('gen/') for x in table), 'gitignore: the refresher does not watch it either', str(len(table)))
        open(os.path.join(gi, 'gen', 'deep', 'g1.ts'), 'a').write('\nexport function x(): number {\n  return 1\n}\n')
        s = json.loads(sh(gi, 'python3', FRESH, 'status', gi, '--json', env=quiet).stdout or '{}')
        check(s.get('state') == 'fresh', 'gitignore: a write into an ignored tree costs no rebuild', json.dumps(s))
        open(os.path.join(gi, 'src', 'util.ts'), 'a').write('\n// edited\n')
        s = json.loads(sh(gi, 'python3', FRESH, 'status', gi, '--json', env=quiet).stdout or '{}')
        check(s.get('state') == 'stale' and 'src/util.ts' in s.get('changed', []), 'control: an edit to a tracked file still makes the graph stale', json.dumps(s))
        t0 = time.time(); b = sh(gi, AX, 'index', '.', env=dict(env, AXIOMCODE_NO_GITIGNORE='1', AXIOMCODE_REINDEX='1')); took = time.time() - t0
        check(b.returncode == 0 and sum(x.startswith('gen/') for x in files(gi)) == 200, f'control: AXIOMCODE_NO_GITIGNORE=1 reads the ignored tree ({took:.1f}s)', b.stdout[-400:])

        # ── no rules ──────────────────────────────────────────────────────────────────────────────────────────
        bindir = os.path.join(work, 'bin-no-souffle'); os.makedirs(bindir)
        for tool in ('python3', 'git', 'bash', 'node', 'sed', 'awk', 'tr', 'cat', 'dirname', 'basename', 'uname', 'head', 'grep', 'mktemp', 'rm'):
            p = shutil.which(tool)
            if p: os.symlink(p, os.path.join(bindir, tool))
        nr = dict(quiet, PATH=bindir + os.pathsep + '/usr/bin:/bin', AXIOMCODE_INTERPRET='1')
        nr['PATH'] = bindir + os.pathsep + os.pathsep.join(d for d in ('/usr/bin', '/bin') if not os.path.exists(os.path.join(d, 'souffle')))
        want = sh(repo, AX, 'impact', 'helper', '.', env=quiet)
        got = sh(repo, AX, 'impact', 'helper', '.', env=nr)
        strip = lambda t: [l for l in t.splitlines() if l.strip().startswith('[')]
        check(got.returncode == 0 and 'answering from the SQL port' in got.stderr and strip(got.stdout) == strip(want.stdout),
              'no rules: impact answers from the SQL port, says so, and gives the same callers', got.stdout[-500:] + got.stderr[-500:])
        check('SQL port' not in want.stderr, 'control: with the rules there, no notice', want.stderr[-300:])
        adv = sh(SCRIPTS, 'python3', '-c', "import sys; sys.path.insert(0, '.'); import dl_program as d; d.shutil.which = lambda n: None; "
                 "d.sys.platform = 'win32'; print(d.rules_unavailable('impact'))", env=nr).stdout
        check('npm i -g @axiomcode/code-graph' in adv and 'brew' not in adv and 'Windows' in adv,
              'no rules: on Windows the advice is the npm package, never Homebrew', adv)
        adv = sh(SCRIPTS, 'python3', '-c', "import sys; sys.path.insert(0, '.'); import dl_program as d; d.shutil.which = lambda n: None; "
                 "d.sys.platform = 'darwin'; print(d.rules_unavailable('impact'))", env=nr).stdout
        check('brew install' in adv, 'control: on macOS it still names Homebrew', adv)
    finally:
        if verbose: print('kept', work)
        else: shutil.rmtree(work, ignore_errors=True)
    print(f"{len(fails)} FAILED" if fails else 'all checks held')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
