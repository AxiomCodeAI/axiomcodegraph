#!/usr/bin/env python3
"""tests/cli_version.py: `axiomcode --version` names the package version (#1352) AND the build it came from.

Every build on a release branch carries the same version, so the version alone could not tell an agent which build
answered it. The line is "<version> (<commit>, <date>)", from the stamp `npm run build` writes into
plugins/axiomcode/build-info.json, or from git in a checkout that has no stamp.

It is answered by the Node launcher before bash is looked for, so it is checked there with no bash on PATH, by
bin/axiomcode for a checkout, and by the skill's own dispatcher (ax_version.py), which the MCP server also reads; all
three must print the same line. On a copy of the package, where each rule can be pinned down:
  no stamp    no stamp and no git: the version alone, never a made-up commit
  stamped     a stamp and no git, as an install from the registry has it: the stamp's commit and date
  other repo  (near miss) the package copied into some other git repository: that repository's commit is NOT reported
  checkout    no stamp: git's HEAD; --write stamps it; a later commit is shown beside the stamp, so a stale build shows
The MCP server names the same build in serverInfo.version and on its start line, and adds a note to an answer once the
installed build is not the one it started on (a server keeps its code until the session reconnects).
With other arguments --version is still the build option, not this.

    python3 tests/cli_version.py
"""
import json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = json.load(open(os.path.join(ROOT, 'package.json')))['version']
BUILD = re.compile(re.escape(VERSION) + r' \([0-9a-f]{7,}, \d{4}-\d{2}-\d{2}(; source now at [0-9a-f]{7,})?\)\n')

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


def run(*cmd, **kw):
    return subprocess.run(list(cmd), capture_output=True, text=True, timeout=60, **kw)


node = shutil.which('node')
with tempfile.TemporaryDirectory() as only_node:
    os.symlink(node, os.path.join(only_node, 'node'))
    # no git on PATH either: the line comes from the stamp when there is one, else it is the version alone
    r = run(node, os.path.join(ROOT, 'bin', 'axiomcode.js'), '--version', env=dict(os.environ, PATH=only_node, AXIOMCODE_BASH=''))
    stamped = os.path.exists(os.path.join(ROOT, 'plugins', 'axiomcode', 'build-info.json'))
    check('the installed command prints the version' + (' and the stamped build' if stamped else '') + ', with no bash or git on PATH',
          r.returncode == 0 and bool(BUILD.fullmatch(r.stdout) if stamped else r.stdout == VERSION + '\n'),
          f'rc={r.returncode} out={r.stdout!r} err={r.stderr[-200:]!r}')

launcher = run(node, os.path.join(ROOT, 'bin', 'axiomcode.js'), '--version')
check('in a checkout the installed command names the build: version, commit and date',
      launcher.returncode == 0 and bool(BUILD.fullmatch(launcher.stdout)), f'rc={launcher.returncode} out={launcher.stdout!r}')
r = run('bash', os.path.join(ROOT, 'bin', 'axiomcode'), '--version')
check('bin/axiomcode prints the same line', r.returncode == 0 and r.stdout == launcher.stdout, f'rc={r.returncode} out={r.stdout!r}')
r = run('bash', os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode'), '--version')
check("the skill's axiomcode prints the same line", r.returncode == 0 and r.stdout == launcher.stdout,
      f'rc={r.returncode} out={r.stdout!r} want {launcher.stdout!r}')
r = run('bash', os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode'), '--verbs')
check('--version is not listed as a verb', r.returncode == 0 and 'version' not in r.stdout, r.stdout)

r = run('bash', os.path.join(ROOT, 'bin', 'axiomcode'), '--version', 'v9')
check('--version with a value is not taken for the version query', r.returncode != 0 and VERSION not in r.stdout,
      f'rc={r.returncode} out={r.stdout!r}')


def both(pkg):
    """the Node and the Python answer on a copied package, which must agree"""
    js = run(node, os.path.join(pkg, 'plugins', 'axiomcode', 'mcp', 'build-info.js'))
    py = run(sys.executable, os.path.join(pkg, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'ax_version.py'))
    return js.stdout, py.stdout


def git(cwd, *a):
    return run('git', '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', *a, cwd=cwd)


def initialize(pkg):
    """the fallback MCP server's initialize reply and its stderr, started from the copied package"""
    frame = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
             'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'tests', 'version': '0'}}}
    r = subprocess.run([sys.executable, '-S', os.path.join(pkg, 'plugins', 'axiomcode', 'mcp', 'server.py')], input=json.dumps(frame) + '\n',
                       capture_output=True, text=True, timeout=60, cwd=pkg, env=dict(os.environ, AXIOMCODE_REFRESH_INTERVAL='0'))
    try:
        return json.loads(r.stdout.splitlines()[0])['result']['serverInfo'], r.stderr
    except (IndexError, KeyError, ValueError):
        return {}, r.stdout + r.stderr


with tempfile.TemporaryDirectory() as work:
    pkg = os.path.join(work, 'pkg')
    os.makedirs(os.path.join(pkg, 'plugins'))
    shutil.copy(os.path.join(ROOT, 'package.json'), pkg)
    shutil.copytree(os.path.join(ROOT, 'plugins', 'axiomcode'), os.path.join(pkg, 'plugins', 'axiomcode'),
                    ignore=shutil.ignore_patterns('build-info.json', '__pycache__', '.cache'))
    stamp = os.path.join(pkg, 'plugins', 'axiomcode', 'build-info.json')

    js, py = both(pkg)
    check('no stamp and no git: the version alone, from Node and from Python', js == py == VERSION + '\n', f'js={js!r} py={py!r}')

    with open(stamp, 'w') as f: json.dump({'version': VERSION, 'commit': '1a2b3c4d', 'date': '2026-01-02'}, f)
    js, py = both(pkg)
    want = f'{VERSION} (1a2b3c4d, 2026-01-02)'
    check('a stamp and no git (a registry install): the stamped commit and date, from Node and from Python', js == py == want + '\n',
          f'js={js!r} py={py!r} want {want!r}')
    info, err = initialize(pkg)
    check('the MCP server names the build in serverInfo.version and on its start line',
          info.get('version') == want and f'serving axiomcode {want}' in err, f'serverInfo={info} stderr={err[-300:]!r}')

    # near miss: the package copied into another project's repository is not that project's build
    outer = os.path.join(work, 'outer'); os.makedirs(outer)
    vendored = os.path.join(outer, 'vendor'); shutil.move(pkg, vendored)
    os.remove(os.path.join(vendored, 'plugins', 'axiomcode', 'build-info.json'))
    git(outer, 'init', '-q'); git(outer, 'add', '-A'); git(outer, 'commit', '-q', '-m', 'x')
    js, py = both(vendored)
    check("near miss: a package inside another project's git repository does not report that project's commit",
          js == py == VERSION + '\n', f'js={js!r} py={py!r}')

    # a checkout of its own
    shutil.rmtree(os.path.join(outer, '.git'))
    git(vendored, 'init', '-q'); git(vendored, 'add', '-A'); git(vendored, 'commit', '-q', '-m', 'one')
    head = git(vendored, 'log', '-1', '--abbrev=8', '--format=%h').stdout.strip()
    js, py = both(vendored)
    check('a checkout with no stamp: its HEAD, from Node and from Python', bool(head) and js == py and f'({head}, ' in js
          and 'source now' not in js, f'js={js!r} py={py!r} head={head}')
    w = run(node, os.path.join(vendored, 'plugins', 'axiomcode', 'mcp', 'build-info.js'), '--write')
    written = json.load(open(os.path.join(vendored, 'plugins', 'axiomcode', 'build-info.json'))) if w.returncode == 0 else {}
    check('build-info.js --write stamps the checkout HEAD', written.get('commit') == head, w.stdout + w.stderr)
    git(vendored, 'commit', '-q', '--allow-empty', '-m', 'two')
    later = git(vendored, 'log', '-1', '--abbrev=8', '--format=%h').stdout.strip()
    js, py = both(vendored)
    check('a checkout that moved past its stamp names both, so a stale build is visible',
          js == py and f'({head}, ' in js and f'source now at {later})' in js, f'js={js!r} py={py!r}')

    # a server started on one build, asked after the installed build changed, says so under its answer
    sys.path.insert(0, os.path.join(vendored, 'plugins', 'axiomcode', 'mcp'))
    os.environ['AXIOMCODE_PLUGIN_ROOT'] = os.path.join(vendored, 'plugins', 'axiomcode')
    import server
    check('control: no note while the installed build is the one the server started on', server.stale_note() == '', server.stale_note())
    with open(os.path.join(vendored, 'plugins', 'axiomcode', 'build-info.json'), 'w') as f:
        json.dump({'version': VERSION, 'commit': later, 'date': '2026-01-03'}, f)
    note = server.stale_note()
    check('a server whose installed build changed under it says so, naming both builds and the reconnect',
          'started on axiomcode' in note and later in note and 'reconnect' in note, note)

print()
print(f"{len(checked) - len(fails)} of {len(checked)} check(s) held" if not fails else f"{len(fails)} FAILED: " + '; '.join(fails))
sys.exit(1 if fails else 0)
