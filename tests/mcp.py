#!/usr/bin/env python3
"""tests/mcp.py — `axiomcode mcp` speaks MCP, from every way an agent can start it.

The package command is how every agent other than Claude Code reaches the tools: one line of MCP config,
`npx -y @axiomcode/code-graph mcp`, and no plugin install. That only holds if the command works where npm
puts it, so the server is started three ways and each has to answer `initialize`, list every tool, and
run one:

  bin/axiomcode mcp            the command itself
  <link>/axiomcode mcp         through a symlink to bin/axiomcode.js, the `bin` entry, the way
                               node_modules/.bin and a global install reach it
  .mcp.json                    Claude Code's server entry, with ${CLAUDE_PLUGIN_ROOT} replaced, and again with
                               a uv on PATH that fails or hangs, which must fall through to the fallback
  python3 -S server.py         without site-packages, so the SDK cannot import and the built-in fallback
                               serves — the path a clean machine takes; it also has to refuse a call whose
                               arguments do not fit the schema it advertised, as the SDK does (#1243)
  .codex-plugin/mcp.json       Codex's server entry, a relative path run from the plugin directory
  .cursor-plugin/plugin.json   Cursor's own server entry, with ${CURSOR_PLUGIN_ROOT} replaced as Cursor does

and a server that is already running when the install moves under it answers the next call from the new install:
through a link retargeted at a newer build, and through a host's install record (in a config
directory of the test's own) that names a newer version's directory (check_install_move)

    python3 tests/mcp.py
"""
import json, os, shutil, subprocess, sys, tempfile, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'bin', 'axiomcode')
LAUNCHER = os.path.join(ROOT, 'bin', 'axiomcode.js')
SERVER = os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'server.py')
# THE SMALL SURFACE: four questions, each with at most two parameters and no options. The front-door answer is capped
# at ten places with the rest counted, so no tool is paged.
TOOLS = {'find': ['question'], 'impact': ['name'], 'path': ['start', 'end'], 'tests': []}


def exchange(cmd, cwd, env=None, workdir=None):
    """initialize, the initialized notification, tools/list and one tools/call, as a client sends them"""
    frames = [
        {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
         'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'tests', 'version': '0'}}},
        {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
        {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
        # No graph exists in cwd, so the answer is the CLI saying so. What is checked is that a call
        # reaches the CLI and comes back as text, not what the graph says.
        {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
         'params': {'name': 'path', 'arguments': {'start': 'a', 'end': 'b'}}},
    ]
    # Stdin stays open until the last reply is in, as a real client keeps it: the SDK server stops
    # reading at EOF and drops a call still in flight, which is not how any client drives it.
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         cwd=workdir or cwd, env=env, text=True)
    timer = threading.Timer(120, p.kill)
    timer.start()
    replies = {}
    try:
        for f in frames:
            p.stdin.write(json.dumps(f) + '\n')
            p.stdin.flush()
            if 'id' not in f:
                continue
            while f['id'] not in replies:
                line = p.stdout.readline()
                if not line:
                    return None, f"server exited before answering {f['method']}: {p.stderr.read().strip()[:300]}"
                try:
                    m = json.loads(line)
                except ValueError:
                    return None, f"stdout carried a line that is not JSON-RPC: {line[:120]!r}"
                if 'id' in m:
                    replies[m['id']] = m
    finally:
        timer.cancel()
        p.stdin.close()
        p.wait()
    return replies, p.stderr.read()


def call(cmd, cwd, name, arguments):
    """one tools/call on a started server, after initialize; the reply's result"""
    frames = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
               'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'tests', 'version': '0'}}},
              {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
              {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}]
    # stdin stays open until the reply is in: the SDK server drops a call still in flight at EOF (see exchange)
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=cwd, text=True)
    timer = threading.Timer(120, p.kill)
    timer.start()
    try:
        p.stdin.write(''.join(json.dumps(f) + '\n' for f in frames))
        p.stdin.flush()
        for line in p.stdout:
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get('id') == 2:
                return m.get('result') or {}
        return {}
    finally:
        timer.cancel()
        p.stdin.close()
        p.wait()


def check_arguments(label, cmd, cwd, lax=False):
    """A call whose arguments do not fit the advertised schema is an error naming the field, never an answer.

    A list sent for a string, a missing parameter, or an option the tool does not take (#1243, #1567) is refused. The
    well-formed calls are the control: each must NOT be refused, or a validator that refuses everything would pass."""
    bad = []
    wrong = [('impact', {'name': ['Excluder.excludeClass']}, 'name'),
             ('path', {'start': 'a'}, 'end'),
             ('path', {'start': 'a', 'end': 'b', 'nope': 1}, 'nope'),
             ('find', {}, 'question'),
             # the options the old tools took are refused, not dropped so that an unnarrowed answer comes back as if
             # it had been narrowed (#1567): the repository is the session's, and there are no flags
             ('find', {'question': 'x', 'in_path': 'src'}, 'in_path: unexpected argument'),
             ('impact', {'name': 'A.f', 'repo': cwd}, 'repo: unexpected argument'),
             ('tests', {'why': True}, 'why: unexpected argument')]
    for name, args, field in wrong:
        res = call(cmd, cwd, name, args)
        text = ' '.join(c.get('text', '') for c in res.get('content', []))
        # the fallback says "invalid arguments", the SDK's own validation "validation error"; both name the field
        if not res.get('isError') or field not in text or not ('invalid arguments' in text or 'validation error' in text):
            bad.append(f"{label}: {name}({json.dumps(args)}) was not refused naming {field!r}: {res}")
    # the control: every parameter a tool declares still passes, including the ones the CLI's hints name
    right = [('find', {'question': 'x'}), ('impact', {'name': 'A.f'}), ('impact', {}),
             ('path', {'start': 'a', 'end': 'b'}), ('tests', {})]
    for name, args in right:
        res = call(cmd, cwd, name, args)
        text = ' '.join(c.get('text', '') for c in res.get('content', []))
        if not text or 'invalid arguments' in text or 'validation error' in text:
            bad.append(f"{label}: well-formed {name}({json.dumps(args)}) was refused or empty: {res}")
    return bad


def check_words():
    """An answer's CLI flags are written as the MCP parameters they are (#1567), and nothing else is touched: quoted
    code, flags only the CLI has, a flag's name inside a longer word, and a flag followed by prose rather than a value."""
    sys.path.insert(0, os.path.dirname(SERVER))
    import server
    cases = [("pass --in <path> to narrow", "pass in_path=<path> to narrow"),
             ("  … +12 (--limit N)", "  … +12 (limit=N)"),
             ("    --tests-only lists all 22 by rung and file; --why adds each one's route",
              "    tests=True lists all 22 by rung and file; why=True adds each one's route"),
             ("ask for --page 2", "ask for page=2"),
             # `--page all` is the string "all" here, and the footer names one spelling per surface, never both
             ("ask for the next with --page 2, or all of it with --page all; --budget N changes the page size",
              'ask for the next with page=2, or all of it with page="all"; budget=N changes the page size'),
             ("narrow instead with --in <path>, --depth N or --tests-only", "narrow instead with in_path=<path>, depth=N or tests=True"),
             ("--page N|all", 'page=N or page="all"'),
             ("narrow with `impact <name> --in <path>` or `path '*' <name> --in parser/src`.",
              "narrow with `impact <name> in_path=<path>` or `path '*' <name> in_path=parser/src`."),
             ("start at --from <start>", "start at from_=<start>"),
             ("no --in was given, so", "no in_path was given, so"),
             # the controls: these must come back unchanged
             ("    --in parser/src                             --in-offered  11302 symbol(s)",
              "    in_path=parser/src                             --in-offered  11302 symbol(s)"),
             ("print it with --json", "print it with --json"),
             ("           49 |   args = ['--in', path, '--tests-only']", "           49 |   args = ['--in', path, '--tests-only']"),
             ("              | … +23 more line(s) --limit", "              | … +23 more line(s) --limit"),
             ("a pre-built --lang java graph", "a pre-built --lang java graph"),
             ('grep -rnw "all" . lists them', 'grep -rnw "all" . lists them'),
             # a site of a grep-shaped answer is the file's own text: a flag written in that code stays as written
             ("tests/freshness.py:294: fn(['--in', p, '--fresh'])  [by name ×2 · mcp_checks]",
              "tests/freshness.py:294: fn(['--in', p, '--fresh'])  [by name ×2 · mcp_checks]"),
             # and the footer under the sites is prose, rewritten as ever
             ("… +3 more not listed: 3 [text] — pass --in <path> to narrow", "… +3 more not listed: 3 [text] — pass in_path=<path> to narrow")]
    return [f"mcp_words({src!r}) gave {server.mcp_words(src)!r}, want {want!r}"
            for src, want in cases if server.mcp_words(src) != want]


def check_front_door():
    """Each tool asks its verb with no flag, in the session's own directory, so the dispatcher answers as places with
    their code (it sees AXIOMCODE_SURFACE=mcp); impact with no name asks about the working tree's edits."""
    sys.path.insert(0, os.path.dirname(SERVER))
    import server
    seen = []
    real, server.run = server.run, (lambda args, *a, **k: seen.append(args) or '')
    cwd = os.getcwd()
    try:
        bad = []
        for call, want in ((lambda: server.find('how is a total computed'), ['find', 'how is a total computed', cwd]),
                           (lambda: server.impact('A.f'), ['impact', 'A.f', cwd]),
                           (lambda: server.impact(''), ['impact', cwd]),
                           (lambda: server.impact(), ['impact', cwd]),
                           (lambda: server.path('a', 'b'), ['path', 'a', 'b', cwd]),
                           (lambda: server.tests(), ['tests', cwd])):
            seen.clear(); call()
            if seen != [want]: bad.append(f"front door: ran {seen}, want {[want]}")
            if any(a.startswith('-') for a in (seen[0] if seen else [])): bad.append(f"front door: a flag was passed: {seen}")
        return bad
    finally:
        server.run = real

class Session:
    """one started server, called as many times as a test needs, as a client keeps it for a whole session"""
    def __init__(self, cmd, cwd, env):
        self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  cwd=cwd, env=env, text=True)
        self.timer = threading.Timer(120, self.p.kill)
        self.timer.start()
        self.n = 0
        self.ask('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'tests', 'version': '0'}})
        self.p.stdin.write(json.dumps({'jsonrpc': '2.0', 'method': 'notifications/initialized'}) + '\n')
        self.p.stdin.flush()

    def ask(self, method, params):
        self.n += 1
        self.p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': self.n, 'method': method, 'params': params}) + '\n')
        self.p.stdin.flush()
        for line in self.p.stdout:
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get('id') == self.n:
                return m.get('result') or {}
        return {}

    def text(self, name, arguments):
        return ''.join(c.get('text', '') for c in self.ask('tools/call', {'name': name, 'arguments': arguments}).get('content', []))

    def close(self):
        self.timer.cancel()
        self.p.stdin.close()
        self.p.wait()
        self.p.stdout.close()
        self.p.stderr.close()


def check_install_move(work):
    """The install moves while a server runs: the next call is answered by the new install's scripts, byte for byte, and
    only when the new install's server.py differs from the running one does a warning come, on the answer's first line.
    Each fake build's CLI prints which build it is; nothing here touches the real host config (HOME and the config
    directory variable are the test's own)."""
    bad = []
    top = os.path.join(work, 'install-move')
    home = os.path.join(top, 'home')
    os.makedirs(home)

    def build(dest, name):
        shutil.copytree(os.path.join(ROOT, 'plugins', 'axiomcode'), dest, symlinks=True)
        cli = os.path.join(dest, 'skills', 'axiomcode', 'scripts', 'axiomcode')
        with open(cli, 'w') as f:
            f.write(f'#!/usr/bin/env bash\necho "answer from {name}"\necho "IMPACT_VERSION {name}"\n')
        os.chmod(cli, 0o755)
        return f'answer from {name}\nIMPACT_VERSION {name}'

    base = {k: v for k, v in os.environ.items() if not k.endswith('PLUGIN_ROOT') and k != 'CLAUDE_CONFIG_DIR'}
    base.update(HOME=home, CLAUDE_CONFIG_DIR=os.path.join(top, 'claude'), AXIOMCODE_REFRESH_INTERVAL='0')
    repo = os.path.join(top, 'repo')
    os.mkdir(repo)
    ask = ('path', {'start': 'a', 'end': 'b'})
    warn = 'WARNING: this axiomcode MCP server is older than the install'

    def expect(label, got, want, warned=False):
        first, _, rest = got.partition('\n')
        if warned and not (first.startswith(warn) and rest == want):
            bad.append(f"install move, {label}: want the warning on the first line and then {want!r}, got {got[:400]!r}")
        elif not warned and got != want:
            bad.append(f"install move, {label}: want exactly {want!r}, got {got[:400]!r}")

    # 1. A LINK TO THE INSTALL, retargeted at a newer build. The server is started through the link with no
    # AXIOMCODE_PLUGIN_ROOT, as a host that expands nothing starts it; node resolves the link in the launcher's path.
    a = build(os.path.join(top, 'builds', 'old', 'plugins', 'axiomcode'), 'the old build')
    b = build(os.path.join(top, 'builds', 'new', 'plugins', 'axiomcode'), 'the new build')
    link = os.path.join(top, 'install')
    os.symlink(os.path.join(top, 'builds', 'old'), link)
    s = Session(['node', os.path.join(link, 'plugins', 'axiomcode', 'mcp', 'launch.js')], repo, base)
    try:
        expect('link, before the move', s.text(*ask), a)
        tmp = link + '.next'
        os.symlink(os.path.join(top, 'builds', 'new'), tmp)
        os.replace(tmp, link)
        expect('link, after the move (same server.py)', s.text(*ask), b)
        with open(os.path.join(top, 'builds', 'new', 'plugins', 'axiomcode', 'mcp', 'server.py'), 'a') as f:
            f.write('\n# a newer server\n')
        expect('link, after the move (newer server.py)', s.text(*ask), b, warned=True)
    finally:
        s.close()

    # 2. A HOST THAT INSTALLS EACH VERSION INTO ITS OWN DIRECTORY and records which one is current. The near miss: a
    # newer entry of another plugin, in another directory, is not this one's install.
    cache = os.path.join(top, 'claude', 'plugins', 'cache', 'mkt', 'axiomcode')
    v1, v2 = os.path.join(cache, '0.0.1'), os.path.join(cache, '0.0.2')
    other = os.path.join(top, 'claude', 'plugins', 'cache', 'mkt', 'another', '9.9.9')
    a = build(v1, 'version 0.0.1')
    b = build(v2, 'version 0.0.2')
    build(other, 'another plugin')
    record = os.path.join(top, 'claude', 'plugins', 'installed_plugins.json')

    def write_record(current):
        with open(record, 'w') as f:
            json.dump({'version': 2, 'plugins': {
                'axiomcode@mkt': [{'scope': 'user', 'installPath': current, 'lastUpdated': '2026-01-0%dT00:00:00.000Z' % (1 if current == v1 else 2)}],
                'another@mkt': [{'scope': 'user', 'installPath': other, 'lastUpdated': '2026-12-31T00:00:00.000Z'}]}}, f)
    write_record(v1)
    s = Session(['node', os.path.join(v1, 'mcp', 'launch.js')], repo, dict(base, AXIOMCODE_PLUGIN_ROOT=v1))
    try:
        expect('recorded install, before the update', s.text(*ask), a)
        write_record(v2)
        expect('recorded install, after the update', s.text(*ask), b)
    finally:
        s.close()
    return bad


def check(label, cmd, cwd, env=None, workdir=None, want_err=None):
    replies, err = exchange(cmd, cwd, env, workdir)
    if replies is None:
        return [f"{label}: {err}"]
    bad = []
    if want_err and want_err not in err:
        bad.append(f"{label}: stderr does not say {want_err!r}: {err.strip()[:300]!r}")
    init = replies.get(1, {}).get('result')
    if not init or 'serverInfo' not in init:
        bad.append(f"{label}: no initialize result (stderr: {err.strip()[:200]})")
    listed = {t['name']: list((t.get('inputSchema') or {}).get('properties', {}))
              for t in replies.get(2, {}).get('result', {}).get('tools', [])}
    if set(listed) != set(TOOLS):
        bad.append(f"{label}: tools/list gave {sorted(listed)}, want {sorted(TOOLS)}")
    for name, params in listed.items():
        if name in TOOLS and (sorted(params) != sorted(TOOLS[name]) or len(params) > 2):
            bad.append(f"{label}: {name} takes {params}, want {TOOLS[name]} (at most two)")
    content = replies.get(3, {}).get('result', {}).get('content', [])
    if not any(c.get('type') == 'text' and c.get('text') for c in content):
        bad.append(f"{label}: tools/call returned no text: {replies.get(3)}")
    return bad


def main():
    bad = []
    with tempfile.TemporaryDirectory() as work:
        repo = os.path.join(work, 'repo')
        os.mkdir(repo)
        link_dir = os.path.join(work, 'bin')
        os.mkdir(link_dir)
        link = os.path.join(link_dir, 'axiomcode')
        os.symlink(LAUNCHER, link)
        bad += check('bin/axiomcode mcp', ['bash', CLI, 'mcp'], repo)
        # the SDK when the launcher finds one, which ignored an argument it did not know (#1567); else the fallback again
        bad += check_arguments('bin/axiomcode mcp', ['bash', CLI, 'mcp'], repo, lax=True)
        bad += check_words()
        bad += check_front_door()
        if os.name != 'nt':
            bad += check_install_move(work)
        bad += check('symlinked axiomcode mcp', [link, 'mcp'], repo)
        env_note = 'python3 -S server.py (fallback, no SDK)'
        bad += check(env_note, [sys.executable, '-S', SERVER], repo)
        bad += check_arguments(env_note, [sys.executable, '-S', SERVER], repo)

        # The plugin's own server entries, run as their hosts run them, from a copy of the plugin under a path
        # with a space, which splits an unquoted path into two words.
        plugin = os.path.join(work, 'plugin cache', 'axiomcode')
        shutil.copytree(os.path.join(ROOT, 'plugins', 'axiomcode'), plugin, symlinks=True)
        base = {k: v for k, v in os.environ.items() if not k.endswith('PLUGIN_ROOT')}

        # Codex's entry: a relative path, started with the plugin directory as cwd, since Codex expands nothing
        # in a plugin's MCP config.
        with open(os.path.join(plugin, '.codex-plugin', 'mcp.json')) as f:
            server = json.load(f)['mcpServers']['axiomcode']
        bad += check('.codex-plugin/mcp.json', [server['command'], *server['args']], repo, base,
                     os.path.join(plugin, server.get('cwd', '.')))

        # Cursor's own manifest names the server with ${CURSOR_PLUGIN_ROOT}, which Cursor replaces with the
        # plugin directory before it starts the command, and starts it in the user's project.
        with open(os.path.join(plugin, '.cursor-plugin', 'plugin.json')) as f:
            server = json.load(f)['mcpServers']['axiomcode']
        expand = lambda v: v.replace('${CURSOR_PLUGIN_ROOT}', plugin)
        cmd = [server['command'], *map(expand, server['args'])]
        env = dict(base, **{k: expand(v) for k, v in server.get('env', {}).items()})
        bad += check('.cursor-plugin/plugin.json', cmd, repo, env, repo)

        with open(os.path.join(plugin, '.mcp.json')) as f:
            server = json.load(f)['mcpServers']['axiomcode']
        expand = lambda v: v.replace('${CLAUDE_PLUGIN_ROOT}', plugin)
        cmd = [server['command'], *map(expand, server['args'])]
        env = dict(base, **{k: expand(v) for k, v in server.get('env', {}).items()})
        bad += check('.mcp.json', cmd, repo, env, repo)

        # A uv on PATH that cannot build its environment is passed over for the fallback, rather than started
        # and left to exit before `initialize` (#1249). python3 and python are shadowed by interpreters without
        # site-packages, so no SDK is found first and the launcher does reach uv; the fake uv records that it
        # was asked, so the case cannot pass without the uv branch having run.
        if os.name != 'nt':
            for label, uv_run, want in (('fails', 'echo "error: Failed to build cryptography" >&2; exit 1', 'Failed to build'),
                                        ('hangs', 'sleep 30', 'no answer within')):
                fake = os.path.join(work, f'uv-{label}')
                os.mkdir(fake)
                asked = os.path.join(fake, 'asked')
                shims = {'uv': f'#!/bin/sh\n[ "$1" = --version ] && {{ echo "uv 0.0.0"; exit 0; }}\n'
                               f'echo "$@" >> "{asked}"\n{uv_run}\n',
                         'python3': f'#!/bin/sh\nexec "{sys.executable}" -S "$@"\n'}
                shims['python'] = shims['python3']
                for name, text in shims.items():
                    with open(os.path.join(fake, name), 'w') as f:
                        f.write(text)
                    os.chmod(os.path.join(fake, name), 0o755)
                uv_env = {k: v for k, v in env.items() if k != 'AXIOMCODE_PYTHON'}
                uv_env.update(PATH=fake + os.pathsep + env.get('PATH', ''), AXIOMCODE_UV_TIMEOUT_MS='2000')
                bad += check(f'.mcp.json with a uv that {label}', cmd, repo, uv_env, repo,
                             want_err=f'uv could not provide the MCP SDK ({want}' if label == 'hangs' else want)
                if not os.path.exists(asked):
                    bad.append(f'.mcp.json with a uv that {label}: the launcher never asked uv, so nothing was tested')

        # A bash named by AXIOMCODE_BASH that is not there is an error that says so, exit 127, rather than
        # a quiet fall back to whatever `bash` PATH holds, which on Windows is the wrong one (#1229).
        r = subprocess.run([link, '--help'], capture_output=True, text=True,
                           env=dict(os.environ, AXIOMCODE_BASH=os.path.join(work, 'no-bash')))
        if r.returncode != 127 or 'AXIOMCODE_BASH' not in r.stderr:
            bad.append(f"axiomcode with a missing AXIOMCODE_BASH: exit {r.returncode}, stderr {r.stderr.strip()[:200]!r}")
    for b in bad:
        print('FAIL', b)
    print('ok' if not bad else f'{len(bad)} failure(s)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
