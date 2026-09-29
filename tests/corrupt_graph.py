#!/usr/bin/env python3
"""tests/corrupt_graph.py — a graph.sqlite that is not a readable database is said, moved aside and rebuilt, never read.

A disk that filled mid-write, a copy cut short or a crash leaves graph.sqlite malformed, and every verb, from the shell
and through the MCP server, died in a Python traceback (`sqlite3.DatabaseError: file is not a database`, `database disk
image is malformed`). Each check lays out a throwaway git repository with a real graph (so it needs the engine, as
tests/refresh_races.py), damages the graph one way, and asks what a user would ask next.

  garbage           graph.sqlite is random bytes: `impact` says the graph is corrupt, rebuilds it and answers; the
                    rebuilt graph reads cleanly and the marker is gone. No traceback.
  truncated         graph.sqlite cut short, asked without a build (as the hooks ask): the last good graph (the kept
                    baseline) answers and the answer says so. With no such graph the verb stops in words, exit 2.
  bad page          the schema reads but a page a query needs does not: the error mid-answer is checked with
                    quick_check, said in words, and the graph moved aside for a rebuild. No traceback.
  up to date        a build over unchanged files with the corrupt marker rebuilds instead of saying "up to date".
  other language    a corrupt graph of another language (.axiomcode/lang/<lang>) is said, and the main language
                    still answers.
Controls: a sound graph answers exactly as before with no word of corruption and no marker; an EMPTY graph.sqlite is
not called corrupt (it is a graph never indexed); a build over unchanged files without the marker is still "up to date".

    python3 tests/corrupt_graph.py [-v]
"""
import json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
BUILD = os.path.join(SCRIPTS, 'axiomcode-build')
IMPACT = os.path.join(SCRIPTS, 'axiomcode-impact')

UTIL = ('export function helper(): number {\n  return 1\n}\n\n'
        'export function caller(): number {\n  return helper()\n}\n\n'
        'export function other(): number {\n  return helper()\n}\n')
TSCONFIG = '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n'


def sh(cwd, *cmd, env=None, timeout=900):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env, timeout=timeout)


def repo_with(work, name, files):
    repo = os.path.join(work, name)
    for rel, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(repo, rel)), exist_ok=True)
        open(os.path.join(repo, rel), 'w').write(text)
    sh(repo, 'git', 'init', '-q'); sh(repo, 'git', 'add', '-A')
    sh(repo, 'git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')
    return repo


def tiers(db):
    import sqlite3
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try: return dict(c.execute("SELECT tier, count(*) FROM call_edges GROUP BY tier").fetchall())
    finally: c.close()


def main(argv):
    verbose = '-v' in argv
    fails = []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok or not (detail or '').strip() else '\n     ' + detail.strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    env = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_NO_REFRESH='1')
    hook = {k: v for k, v in env.items() if k not in ('AXIOMCODE_AUTOBUILD', 'AXIOMCODE_BUILD_NOWAIT')}   # as the hooks ask
    work = tempfile.mkdtemp(prefix='axiomcode-corrupt-')
    try:
        repo = repo_with(work, 'app', {'tsconfig.json': TSCONFIG, 'src/util.ts': UTIL})
        out = os.path.join(repo, '.axiomcode', 'out'); ptr = os.path.join(out, 'graph.sqlite')
        b = sh(repo, AX, 'index', '.', env=env)
        check(b.returncode == 0, 'the graph builds', b.stdout + b.stderr)
        good = os.path.realpath(ptr); saved = os.path.join(work, 'good.sqlite'); shutil.copyfile(good, saved)
        t0 = tiers(good)

        # ── control: a sound graph ──────────────────────────────────────────────────────────────────────────
        r0 = sh(repo, AX, 'impact', 'helper', '.', env=env)
        check(r0.returncode == 0 and 'caller' in r0.stdout, 'control: a sound graph answers', r0.stdout + r0.stderr)
        check('corrupt' not in (r0.stdout + r0.stderr) and not os.path.exists(os.path.join(out, 'corrupt')),
              'control: a sound graph is never called corrupt', r0.stderr)
        u = sh(repo, 'bash', BUILD, repo, env=env)
        check('up to date' in u.stdout, 'control: a build over unchanged files without the marker is still "up to date"', u.stdout + u.stderr)

        # ── garbage ─────────────────────────────────────────────────────────────────────────────────────────
        open(good, 'wb').write(os.urandom(8192))
        t = time.time(); r = sh(repo, AX, 'impact', 'helper', '.', env=env); took = time.time() - t
        both = r.stdout + r.stderr
        check('Traceback' not in both, 'garbage: no traceback', both)
        check('is corrupt' in r.stderr, 'garbage: the verb says the graph is corrupt', both)
        check(r.returncode == 0 and 'caller' in r.stdout, f'garbage: the graph is rebuilt and the verb answers ({took:.0f}s)', both)
        check(os.path.exists(ptr) and tiers(os.path.realpath(ptr)) == t0, 'garbage: the rebuilt graph reads cleanly, with the same edges', str(t0))
        check(not os.path.exists(os.path.join(out, 'corrupt')), 'garbage: the corrupt marker goes with the rebuild')

        # ── truncated, with and without a last good graph ───────────────────────────────────────────────────
        good = os.path.realpath(ptr)
        base = os.path.join(repo, '.axiomcode', 'base', 'out'); os.makedirs(base, exist_ok=True)
        shutil.copyfile(saved, os.path.join(base, 'graph.sqlite'))                   # a baseline a refresh kept
        data = open(good, 'rb').read(); open(good, 'wb').write(data[:len(data) // 3])
        r = sh(repo, 'python3', IMPACT, 'helper', repo, env=hook)
        both = r.stdout + r.stderr
        check('Traceback' not in both, 'truncated: no traceback', both)
        check(r.returncode == 0 and 'caller' in r.stdout and 'last good graph' in r.stderr,
              'truncated: the last good graph answers, and the answer says so', both)
        check(os.path.exists(os.path.join(out, 'corrupt')), 'truncated: the repository is marked for a rebuild')
        shutil.rmtree(os.path.join(repo, '.axiomcode', 'base'))
        shutil.copyfile(saved, good); open(good, 'wb').write(data[:len(data) // 3])
        r = sh(repo, 'python3', IMPACT, 'helper', repo, env=hook)
        both = r.stdout + r.stderr
        check('Traceback' not in both and r.returncode == 2 and 'corrupt' in both and 'axiomcode index' in both,
              'truncated: with no earlier graph the verb stops in words that name the fix', both)

        # ── up to date ──────────────────────────────────────────────────────────────────────────────────────
        u = sh(repo, 'bash', BUILD, repo, env=env)
        check(u.returncode == 0 and 'up to date' not in u.stdout and os.path.exists(ptr) and tiers(os.path.realpath(ptr)) == t0,
              'up to date: a build with the corrupt marker rebuilds instead of saying "up to date"', u.stdout + u.stderr)
        check(not os.path.exists(os.path.join(out, 'corrupt')), 'up to date: the marker goes with the rebuild')

        # ── through the MCP server ──────────────────────────────────────────────────────────────────────────
        # the server runs the verb without waiting for a build (AXIOMCODE_BUILD_NOWAIT) and hands back its words
        open(os.path.realpath(ptr), 'wb').write(os.urandom(8192))
        sys.path.insert(0, os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp')); os.environ.update(AXIOMCODE_ENGINE=ROOT, AXIOMCODE_NO_REFRESH='1')
        import server
        text = server.run(['impact', 'helper', repo])
        check('Traceback' not in text and 'corrupt' in text, 'mcp: the tool answer says the graph is corrupt, no traceback', text)
        sys.path.insert(0, SCRIPTS); import ax_fresh
        for _ in range(600):                                                          # the rebuild it started
            if os.path.exists(ptr) and not ax_fresh.building(repo): break
            time.sleep(1)
        text = server.run(['impact', 'helper', repo])
        check('caller' in text and 'corrupt' not in text, 'mcp: once rebuilt the tool answers again', text)

        # ── bad page ────────────────────────────────────────────────────────────────────────────────────────
        good = os.path.realpath(ptr)
        data = bytearray(open(good, 'rb').read()); page = int.from_bytes(data[16:18], 'big') or 65536
        for p in range(max(2, len(data) // page // 2), len(data) // page):            # the later pages: tables, not the schema
            data[p * page:p * page + 8] = b'\xff' * 8
        open(good, 'wb').write(bytes(data))
        import sqlite3
        try:
            sqlite3.connect(f'file:{good}?mode=ro', uri=True).execute("SELECT count(*) FROM sqlite_master").fetchone(); probe = True
        except sqlite3.DatabaseError: probe = False
        r = sh(repo, 'python3', IMPACT, 'helper', repo, env=hook)
        both = r.stdout + r.stderr
        check('Traceback' not in both and 'corrupt' in both, f'bad page: the error {"mid-answer" if probe else "on open"} is said in words, not a traceback', both)
        check(not os.path.exists(good) or os.path.exists(good + '.corrupt'), 'bad page: the graph is moved aside for a rebuild')
        u = sh(repo, 'bash', BUILD, repo, env=env)
        check(u.returncode == 0 and tiers(os.path.realpath(ptr)) == t0, 'bad page: the next build restores the graph', u.stdout + u.stderr)

        # ── control: an empty graph.sqlite is not corrupt ───────────────────────────────────────────────────
        sys.path.insert(0, SCRIPTS); import ax_fresh
        empty = os.path.join(work, 'empty.sqlite'); open(empty, 'w').close()
        check(ax_fresh.graph_corrupt(empty) == '', 'control: an empty graph.sqlite is not called corrupt (it was never indexed)')
        check(ax_fresh.graph_corrupt(os.path.realpath(ptr)) == '' and ax_fresh.graph_corrupt(os.path.realpath(ptr), thorough=True) == '',
              'control: a sound graph passes the probe and quick_check')

        # ── other language ──────────────────────────────────────────────────────────────────────────────────
        mixed = repo_with(work, 'mixed', {'tsconfig.json': TSCONFIG, 'src/util.ts': UTIL,
                                          'pkg/__init__.py': '', 'pkg/m.py': 'def h():\n    return 1\n\ndef g():\n    return h()\n'})
        b = sh(mixed, AX, 'index', '.', '--lang', 'typescript,python', env=env)
        ldb = os.path.join(mixed, '.axiomcode', 'lang', 'python', 'out', 'graph.sqlite')
        check(b.returncode == 0 and os.path.isfile(ldb), 'other language: both graphs build', b.stdout + b.stderr)
        if os.path.isfile(ldb):
            open(ldb, 'wb').write(os.urandom(8192))
            r = sh(mixed, AX, 'impact', 'helper', '.', env=env)
            both = r.stdout + r.stderr
            check('Traceback' not in both and 'caller' in r.stdout, 'other language: the main language still answers, no traceback', both)
            check('python graph' in both and 'corrupt' in both, 'other language: the corrupt python graph is named', both)
            for _ in range(600):                                                      # its background rebuild
                if os.path.isfile(ldb) and not ax_fresh.graph_corrupt(ldb) and not ax_fresh.building(mixed): break
                time.sleep(1)
            r = sh(mixed, AX, 'impact', 'h', '.', env=env)
            check(r.returncode == 0 and 'g' in r.stdout and 'corrupt' not in r.stderr, 'other language: its graph is rebuilt and answers again', r.stdout + r.stderr)
    finally:
        if verbose: print('work dir:', work)
        else: shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'FAILED' if fails else 'passed'}: {len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
