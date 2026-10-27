#!/usr/bin/env python3
"""tests/two_versions.py: two axiomcode versions over one repository rebuild its graph once, not on every turn, say that
two versions are running, and an orphaned older install writes nothing into .axiomcode.

An agent session started before an engine or plugin upgrade keeps the old version's MCP server and hooks running beside
the new ones. The old one rebuilt the graph with its engine, the new one rebuilt it back, and so on, a full rebuild on
every turn; the answers said "stale graph"; and the old one's refresher recreated .axiomcode while the user deleted it.

  turns     this axiomcode rebuilds a graph an older one built, once; when that older one rebuilds it again afterwards,
            this one does not rebuild it in the background again (refresher, hook, query), and the status, the query's
            note and the hook all say two versions are running and to restart the agent session. Controls: an older
            graph met for the first time is rebuilt; a rebuild that failed (the older graph not rebuilt since) is retried;
            `index` (uptodate) still rebuilds a contested graph, asked for by name
  newer     an older axiomcode over a graph a newer one built keeps it, and says the two-versions case (note and the
            `newer` command), not only "built by a newer axiomcode"
  orphan    an install whose plugin directory carries .orphaned_at, or whose files are gone, writes nothing under
            .axiomcode from its refresh hook (session start, an edit), its other hooks, its timer (hook_kick), its
            refresher, a query, or its MCP server, and says it is an orphaned older version to restart; the MCP server
            refuses to start. Control: the same copy without the mark does write (the refresher starts on an edit)

No engine: a stand-in engine directory, and a stand-in build that records what built the graph, as freshness.py does.

    python3 tests/two_versions.py [-v]
"""
import json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import freshness                                          # its stand-in engine and repository
from freshness import ax_fresh, fake_engine, fake_repo, check, RESULTS, SCRIPTS, ROOT, DRIVER

PLUGIN = os.path.join(ROOT, 'plugins', 'axiomcode')

# the stand-in build: records that it ran, and writes the file table as this axiomcode's build would (built_by, built)
BUILD = r"""
import json, os, sys, time
sys.path.insert(0, os.environ['TV_SCRIPTS']); import ax_fresh
repo = sys.argv[2]
open(os.path.join(repo, 'builds'), 'a').write('x\n')
tp = ax_fresh.table_path(repo); t = json.load(open(tp))
t.update(built=time.time(), files=ax_fresh.snapshot(repo, 'python', repo), built_by=ax_fresh.built_by(ax_fresh.current_engine(repo), 'python'))
json.dump(t, open(tp, 'w'))
"""


def tree(d):
    """every path under d with its size and mtime: what a process wrote there"""
    out = {}
    for root, dirs, files in os.walk(d):
        for f in dirs + files:
            p = os.path.join(root, f)
            try: st = os.lstat(p); out[os.path.relpath(p, d)] = (st.st_size, st.st_mtime_ns)
            except OSError: pass
    return out


def diff(a, b):
    return sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))


def turns_checks(work, env):
    fb = os.path.join(work, 'build.py'); open(fb, 'w').write(BUILD)
    runner = os.path.join(work, 'runner.sh'); open(runner, 'w').write(f'#!/bin/sh\nexec "{sys.executable}" "{fb}" "$@"\n'); os.chmod(runner, 0o755)
    wenv = dict(env, AXIOMCODE_BASH=runner, TV_SCRIPTS=SCRIPTS)

    def builds(repo):
        try: return len(open(os.path.join(repo, 'builds')).read().split())
        except OSError: return 0

    def worker(repo):
        subprocess.run([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'worker', repo], env=wenv, capture_output=True, text=True, timeout=60)
        return builds(repo)

    other = dict(engine_version='0.9.0', engine_hash='0' * 40, engine_stat='0' * 40)

    def older_turn(repo):
        """the older axiomcode rebuilds the graph with its own engine: the table records it, built now"""
        tp = ax_fresh.table_path(repo); t = json.load(open(tp))
        t['built_by'].update(other); t['built'] = time.time(); json.dump(t, open(tp, 'w'))

    repo = fake_repo(work, 'turns'); os.remove(os.path.join(repo, '.axiomcode/refresh.json'))
    older_turn(repo)
    s = ax_fresh.status(repo)
    check("turns: control: an older axiomcode's graph met for the first time is stale and not contested",
          s.get('engine', '').startswith('graph built by an older axiomcode') and not s.get('contested'), s)
    n1 = worker(repo)
    check("turns: control: the refresher rebuilds an older axiomcode's graph once", n1 == 1, n1)
    check("turns: after this one's rebuild the graph is current", ax_fresh.status(repo).get('state') == 'fresh', ax_fresh.status(repo))
    rounds = []
    for i in range(3):
        time.sleep(0.02); older_turn(repo)                 # the older one, still running, rebuilds it back
        rounds.append(worker(repo))
    check(f"turns: the older one rebuilding it back three times costs no further rebuild here (builds after each turn: {rounds})",
          rounds == [1, 1, 1], rounds)
    s = ax_fresh.status(repo)
    two = s.get('contested', '')
    check("turns: the status names the two-versions case: both versions, and restart the agent session",
          'two axiomcode versions are running' in two and 'axiomcode 0.9.0' in two and 'axiomcode 1.0.0' in two
          and 'restart the agent session' in two and ax_fresh.read_state(repo).get('state') == 'contested', s)
    # a query answers from it, starts nothing, waits for nothing, and its note is the two-versions line, not a stale-graph one
    driver = os.path.join(work, 'driver.py'); open(driver, 'w').write(DRIVER.replace("ax_fresh.kick = lambda *a, **k: True",
                                                                                        "ax_fresh.kick = lambda *a, **k: open(os.path.join(sys.argv[2], 'kicked'), 'w').close() or True"))
    t0 = time.time()
    r = subprocess.run([sys.executable, driver, SCRIPTS, repo, 'impact', '--', sys.executable, '-c', "print('rows')"],
                       capture_output=True, text=True, env=dict(env, AXIOMCODE_FRESH_WAIT='30'))
    took = time.time() - t0
    check(f"turns: a query answers at once ({took:.1f}s), starts no rebuild, and says two versions are running rather than 'rebuilding'",
          r.stdout.strip() == 'rows' and 'two axiomcode versions are running' in r.stderr and 'rebuilding in the background' not in r.stderr
          and 'queued' not in r.stderr and 'background rebuild' not in r.stdout and not os.path.exists(os.path.join(repo, 'kicked')) and took < 10, (r.stdout, r.stderr))
    h = ax_fresh.hook_kick(repo, 'the PostToolUse hook', session='s9', event='UserPromptSubmit')
    check("turns: the hook says the two-versions case once", 'two axiomcode versions are running' in h
          and ax_fresh.hook_kick(repo, 'the PostToolUse hook', session='s9', event='UserPromptSubmit') == '', h)
    time.sleep(0.02); older_turn(repo)                    # the older one's graph, whichever way the turns above went
    u = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'uptodate', repo, 'python', '', ''], capture_output=True, text=True, env=env)
    check("turns: control: `index` (uptodate) still rebuilds a contested graph, asked for by name", u.returncode == 1 and 'rebuilding' in u.stdout, u.stdout)

    # control: a rebuild that FAILED leaves the older graph as it was (not rebuilt since): that is no contest, it is retried
    repo = fake_repo(work, 'failed'); os.remove(os.path.join(repo, '.axiomcode/refresh.json'))
    older_turn(repo); ax_fresh.displace(repo, ax_fresh.load_table(repo))
    check("turns: control: an older graph not rebuilt since this one displaced it (a failed rebuild) is not contested, and is rebuilt",
          not ax_fresh.status(repo).get('contested') and worker(repo) == 1, ax_fresh.status(repo))


def newer_checks(work, env):
    repo = fake_repo(work, 'newer'); os.remove(os.path.join(repo, '.axiomcode/refresh.json'))
    tp = ax_fresh.table_path(repo); t = json.load(open(tp)); t['built_by'].update(engine_version='1.0.1'); json.dump(t, open(tp, 'w'))
    s = ax_fresh.status(repo)
    note = ax_fresh.note(s)
    check("newer: an older axiomcode over a newer one's graph says two versions are running and to restart, and that it does not rebuild",
          s.get('newer') and 'engine 1.0.1, this one is 1.0.0' in note and 'two axiomcode versions are running' in note
          and 'restart the agent session' in note and 'does not rebuild' in note, note)
    n = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'ax_fresh.py'), 'newer', repo], capture_output=True, text=True, env=env)
    check("newer: `index` is told the two-versions case too", n.returncode == 0 and 'two axiomcode versions are running' in n.stdout, n.stdout)


def orphan_checks(work, env):
    fb = os.path.join(work, 'build-orphan.py'); open(fb, 'w').write("import os, sys; open(os.path.join(sys.argv[2], 'builds'), 'a').write('x\\n')\n")
    runner = os.path.join(work, 'runner-orphan.sh'); open(runner, 'w').write(f'#!/bin/sh\nexec "{sys.executable}" "{fb}" "$@"\n'); os.chmod(runner, 0o755)
    cfg = os.path.join(work, 'agent-config'); os.makedirs(cfg)
    # TMPDIR: the hooks remember a session's repositories there, and a session-start hook refreshes them too
    oenv = dict(env, AXIOMCODE_BASH=runner, AXIOMCODE_REFRESH_DEBOUNCE='0.05', CLAUDE_CONFIG_DIR=cfg, TMPDIR=os.path.join(work, 'tmp'))
    os.makedirs(oenv['TMPDIR'])
    for k in ('AXIOMCODE_PLUGIN_ROOT', 'AXIOMCODE_NO_REFRESH'): oenv.pop(k, None)

    # this checkout's plugin version, which the orphan message names (it moves with every release)
    VERSION = json.load(open(os.path.join(PLUGIN, '.claude-plugin', 'plugin.json'), encoding='utf-8'))['version']

    def install(name, mark):
        """a copy of this plugin in a versioned plugin cache: <cache>/<marketplace>/<plugin>/<version>"""
        d = os.path.join(work, 'cache', name, 'axiomcode', VERSION)
        shutil.copytree(PLUGIN, d, ignore=shutil.ignore_patterns('__pycache__'))
        if mark: open(os.path.join(d, '.orphaned_at'), 'w').write('1791880805485\n')
        return d

    def edited_repo(name):
        repo = fake_repo(work, name); os.remove(os.path.join(repo, '.axiomcode/refresh.json'))
        open(os.path.join(repo, 'shop/api.py'), 'a').write('\ndef audit(items):\n    return total(items)\n')
        return repo

    def hook(plugin, repo, event, **extra):
        ev = dict(hook_event_name=event, cwd=repo, session_id='two-versions-' + os.path.basename(repo), **extra)
        return subprocess.run([sys.executable, os.path.join(plugin, 'hooks', 'refresh.py')], input=json.dumps(ev), capture_output=True, text=True, env=oenv, timeout=30)

    def everything(plugin, repo):
        """every path by which an install writes into .axiomcode without being asked to; returns what the hooks printed"""
        said = hook(plugin, repo, 'SessionStart').stdout
        hook(plugin, repo, 'PostToolUse', tool_name='Edit', tool_input=dict(file_path=os.path.join(repo, 'shop/api.py')))
        for h in ('changes.py', 'orient.py', 'assist.py'):
            subprocess.run([sys.executable, os.path.join(plugin, 'hooks', h)], input=json.dumps(dict(hook_event_name='UserPromptSubmit', cwd=repo, session_id='two-versions-' + os.path.basename(repo),
                           prompt='how does run reach total')), capture_output=True, text=True, env=oenv, timeout=60)
        scripts = os.path.join(plugin, 'skills', 'axiomcode', 'scripts')
        code = ("import sys; sys.path.insert(0, sys.argv[1]); import ax_fresh; ax_fresh.hook_kick(sys.argv[2], 'the timer'); "
                "ax_fresh.kick(sys.argv[2]); ax_fresh.worker(sys.argv[2])")
        subprocess.run([sys.executable, '-c', code, scripts, repo], capture_output=True, text=True, env=oenv, timeout=60)
        q = subprocess.run([sys.executable, os.path.join(scripts, 'ax_fresh.py'), 'query', repo, 'impact', '--', sys.executable, '-c', "print('rows')"],
                           capture_output=True, text=True, env=oenv, timeout=60)
        time.sleep(1.0)                                     # a detached refresher, had one been started, has written by now
        return said, q.stdout

    # control first: the same copy, not orphaned, does write on an edit (else "wrote nothing" below would prove nothing)
    live = install('live', mark=False); repo = edited_repo('orphan-control')
    before = tree(os.path.join(repo, '.axiomcode')); everything(live, repo); time.sleep(1.5)
    wrote = diff(before, tree(os.path.join(repo, '.axiomcode')))
    check("orphan: control: the same install, not orphaned, writes under .axiomcode after an edit (the refresher starts)",
          'refresh.log' in wrote and 'refresh.json' in wrote, wrote)

    plugin = install('marked', mark=True); repo = edited_repo('orphan-marked')
    before = tree(os.path.join(repo, '.axiomcode')); said, q = everything(plugin, repo)
    wrote = diff(before, tree(os.path.join(repo, '.axiomcode')))
    check("orphan: an install marked .orphaned_at writes nothing under .axiomcode (hooks, timer, refresher, query)", wrote == [] and not
          os.path.exists(os.path.join(repo, 'builds')), wrote)
    check("orphan: its session-start hook says it is an orphaned older version and to restart the agent session",
          f'orphaned older axiomcode {VERSION}' in said and 'Restart the agent session' in said, said)
    check("orphan: its query answers with the restart, not from a build of its own", 'orphaned older axiomcode' in q and 'rows' not in q, q)
    # the MCP server: a tool call answers with the restart and writes nothing; started anew it refuses to start
    code = ("import os, sys; sys.path.insert(0, os.path.join(sys.argv[1], 'mcp')); import server; "
            "print(server.run(['impact', 'run', sys.argv[2]]))")
    before = tree(os.path.join(repo, '.axiomcode'))
    r = subprocess.run([sys.executable, '-c', code, plugin, repo], capture_output=True, text=True, cwd=repo, timeout=60,
                       env=dict(oenv, AXIOMCODE_PLUGIN_ROOT=plugin))
    check("orphan: its MCP server's tool call answers that it is an orphaned older version, running nothing",
          'orphaned older axiomcode' in r.stdout and 'Restart the agent session' in r.stdout and diff(before, tree(os.path.join(repo, '.axiomcode'))) == [],
          (r.stdout, r.stderr[-400:]))
    r = subprocess.run([sys.executable, os.path.join(plugin, 'mcp', 'server.py')], capture_output=True, text=True, cwd=repo, timeout=60,
                       stdin=subprocess.DEVNULL, env=dict(oenv, AXIOMCODE_PLUGIN_ROOT=plugin))
    check("orphan: its MCP server, started, says so and does not start, writing nothing",
          r.returncode != 0 and 'orphaned older axiomcode' in r.stderr and 'Not starting' in r.stderr
          and diff(before, tree(os.path.join(repo, '.axiomcode'))) == [], (r.returncode, r.stderr[-400:]))

    # the install directory deleted under a running process (the plugin manager's later step): nothing is written either
    plugin = install('gone', mark=False); repo = edited_repo('orphan-gone')
    scripts = os.path.join(plugin, 'skills', 'axiomcode', 'scripts')
    before = tree(os.path.join(repo, '.axiomcode'))
    code = ("import shutil, sys; sys.path.insert(0, sys.argv[1]); import ax_fresh; shutil.rmtree(sys.argv[3]); "
            "print(ax_fresh.orphaned()); ax_fresh.hook_kick(sys.argv[2], 'the timer'); ax_fresh.kick(sys.argv[2]); ax_fresh.worker(sys.argv[2])")
    r = subprocess.run([sys.executable, '-c', code, scripts, repo, plugin], capture_output=True, text=True, env=oenv, timeout=60)
    time.sleep(1.0)
    wrote = diff(before, tree(os.path.join(repo, '.axiomcode')))
    check("orphan: a running process whose install directory was deleted says so and writes nothing under .axiomcode",
          'is gone' in r.stdout and 'Restart the agent session' in r.stdout and wrote == [], (r.stdout, r.stderr[-400:], wrote))
    check("orphan: control: this checkout (no mark, files present) is not orphaned", ax_fresh.orphaned() == '', ax_fresh.orphaned())


def main():
    work = tempfile.mkdtemp(prefix='axiomcode-two-versions-'); saved = os.environ.get('AXIOMCODE_ENGINE')
    try:
        e1 = fake_engine(os.path.join(work, 'e1'), version='1.0.0'); os.environ['AXIOMCODE_ENGINE'] = e1
        env = {k: v for k, v in os.environ.items() if k not in ('AXIOMCODE_NO_REFRESH', 'AXIOMCODE_FRESH', 'AXIOMCODE_GRAPH')}
        env.update(AXIOMCODE_REFRESH_DEBOUNCE='0.05', AXIOMCODE_REFRESH_SLOTS=os.path.join(work, 'slots'))
        for part in (turns_checks, newer_checks, orphan_checks):
            try: part(work, env)
            except Exception as e:                        # a missing helper is a failure of that part, not of the run
                check(f"{part.__name__}: ran to the end", False, f"{type(e).__name__}: {e}")
    finally:
        if saved is None: os.environ.pop('AXIOMCODE_ENGINE', None)
        else: os.environ['AXIOMCODE_ENGINE'] = saved
        shutil.rmtree(work, ignore_errors=True)
    bad = [n for n, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(bad)} passed, {len(bad)} failed")
    return 1 if bad or not RESULTS else 0


if __name__ == '__main__':
    sys.exit(main())
