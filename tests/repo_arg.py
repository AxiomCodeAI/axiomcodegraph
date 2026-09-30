#!/usr/bin/env python3
"""tests/repo_arg.py — a repository argument that is not there is an error, never the working directory.

`axiomcode impact <name> <repo>` took a <repo> naming no directory for a second target, answered for the working
directory instead, and on one with no graph started a full build of it (a parent of many projects, for minutes). The
other query verbs and the MCP tools' repo parameter did the same. `index --src <absolute path>` joined the absolute
path onto the repository, a tree that is not there.

Checks, each run from a working directory with no graph, so a fall-back to it would build one there:
  every verb (index, context, path, impact, changed, test-impact, graph) given a missing repository exits non-zero,
  names the path, and builds nothing: no .axiomcode appears in the working directory
  index --src <missing absolute> and --src <missing relative> are refused the same way
  a verb script run directly (not through the dispatcher) with a missing repository is refused and builds nothing
  the MCP tools refuse a missing repo= before anything runs, and pass an existing one through
  near misses, which must keep working: an existing repository answers; a target written like a file (`m.py:1`,
  `pkg/m.py`) is still a target, not a repository; index --src <absolute path inside the repository> builds the
  subtree, recorded relative to the repository

    python3 tests/repo_arg.py
"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
AX = os.path.join(SCRIPTS, 'axiomcode')
bad = []


def ax(args, cwd, env=None):
    return subprocess.run(['bash', AX] + args, cwd=cwd, capture_output=True, text=True, env=env, timeout=600)


def no_graph(where, what):
    if os.path.exists(os.path.join(where, '.axiomcode')): bad.append(f"{what}: a .axiomcode appeared in {where}")


tmp = os.path.realpath(tempfile.mkdtemp(prefix='ax-repo-arg-'))
try:
    cwd = os.path.join(tmp, 'cwd'); os.makedirs(cwd)
    with open(os.path.join(cwd, 'c.py'), 'w') as f: f.write("def here():\n    return 0\n")
    repo = os.path.join(tmp, 'repo'); os.makedirs(os.path.join(repo, 'sub'))
    with open(os.path.join(repo, 'sub', 'm.py'), 'w') as f: f.write("def foo():\n    return 1\n\ndef bar():\n    return foo()\n")
    with open(os.path.join(repo, 'top.py'), 'w') as f: f.write("def outside():\n    return 2\n")
    missing = os.path.join(tmp, 'not-there')

    # 1. a missing repository, every verb: refused, named, nothing built in the working directory or at the path
    for args in (['impact', 'foo', missing], ['impact', 'foo', 'bar', missing], ['impact', 'foo', './not-there'],
                 ['context', 'how does foo work', missing], ['context', 'how does foo work', 'not-there'],
                 ['path', 'bar', 'foo', missing], ['path', 'bar', 'foo', 'not-there'],
                 ['changed', missing], ['test-impact', missing], ['graph', missing],
                 ['index', missing], ['index', 'not-there'],
                 ['index', '--src', missing], ['index', '--src', 'not-there'], ['index', '--lang', 'python', '--src', missing]):
        r = ax(args, cwd)
        named = args[-1] if args[-1] != '--src' else args[-2]
        if r.returncode == 0: bad.append(f"{' '.join(args)}: exit 0 for a missing repository")
        if named not in r.stderr: bad.append(f"{' '.join(args)}: the message does not name {named!r}: {r.stderr.strip()[:200]!r}")
        if 'no such directory' not in r.stderr: bad.append(f"{' '.join(args)}: no 'no such directory' in {r.stderr.strip()[:200]!r}")
        no_graph(cwd, ' '.join(args))
        if os.path.exists(missing): bad.append(f"{' '.join(args)}: created {missing}")

    # 2. a verb script run directly, with the dispatcher's autobuild on: still refused, nothing built
    env = dict(os.environ, AXIOMCODE_AUTOBUILD='1')
    for verb, args in (('axiomcode-context', ['how does foo work', missing]), ('axiomcode-path', ['bar', 'foo', missing])):
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, verb)] + args, cwd=cwd, capture_output=True, text=True, env=env, timeout=120)
        if r.returncode == 0 or missing not in r.stderr: bad.append(f"{verb} {args}: not refused (exit {r.returncode}): {r.stderr.strip()[:200]!r}")
        no_graph(cwd, verb)

    # 3. the MCP tools take no repository: each asks about the session's own directory, and a repo= is refused as an
    # unknown argument before anything runs
    sys.path.insert(0, os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp'))
    import server
    seen = []
    real, server.run = server.run, (lambda args, *a, **k: seen.append(args) or 'ran')
    try:
        calls = {'find': lambda: server.find('how'), 'path': lambda: server.path('a', 'b'),
                 'impact': lambda: server.impact('foo'), 'tests': lambda: server.tests()}
        for name, call in calls.items():
            seen.clear(); call()
            if not seen or seen[0][-1] != os.getcwd(): bad.append(f"{name}(): did not ask about the working directory: {seen}")
            if not server.unknown_arguments(name, {'repo': repo}):
                bad.append(f"{name}(repo=…): not refused")
    finally:
        server.run = real

    # 4. near misses. An absolute --src inside the repository builds that subtree, recorded relative to the repository
    r = ax(['index', repo, '--lang', 'python', '--src', os.path.join(repo, 'sub')], cwd)
    if r.returncode: bad.append(f"index --src <absolute>: exit {r.returncode}: {(r.stderr or r.stdout)[-300:]}")
    else:
        import json, sqlite3
        db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
        names = {n for (n,) in sqlite3.connect(db).execute("SELECT name FROM symbols")} if os.path.exists(db) else set()
        if 'foo' not in names: bad.append(f"index --src <absolute>: foo (under sub/) is not in the graph: {sorted(names)[:10]}")
        if 'outside' in names: bad.append("index --src <absolute>: top.py, outside the subtree, was indexed")
        t = json.load(open(os.path.join(repo, '.axiomcode', 'out', 'files.json')))
        if t.get('src_arg') != 'sub': bad.append(f"index --src <absolute>: recorded src_arg {t.get('src_arg')!r}, want 'sub'")
    no_graph(cwd, 'index <repo> --src <absolute>')
    # an existing repository answers; targets written like files are targets, not a repository
    for args, want in ((['impact', 'foo', repo], 'bar'), (['impact', 'sub/m.py:1', repo], 'bar'),
                       (['impact', 'foo', 'sub/m.py:1', repo], 'bar'), (['path', 'bar', 'foo', repo], 'foo'),
                       (['context', 'how does bar reach foo', repo], 'm.py')):
        r = ax(args, cwd)
        if r.returncode or want not in r.stdout: bad.append(f"{' '.join(args)}: exit {r.returncode}, {want!r} not in the answer: {(r.stdout + r.stderr)[-300:]!r}")
        if 'no such directory' in r.stderr: bad.append(f"{' '.join(args)}: refused an existing repository")
    no_graph(cwd, 'queries on an existing repository')
    # and from inside the repository, a relative target path is a target (it does not exist as a directory either)
    r = ax(['impact', 'foo', 'sub/m.py'], repo)
    if 'no such directory' in r.stderr: bad.append(f"impact foo sub/m.py: a file-like target was taken for a repository: {r.stderr.strip()[:200]!r}")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

for b in bad: print(f"FAIL {b}")
print(f"repo_arg: {'ok' if not bad else f'{len(bad)} failure(s)'}")
sys.exit(1 if bad else 0)
