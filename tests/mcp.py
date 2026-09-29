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

    python3 tests/mcp.py
"""
import json, os, shutil, subprocess, sys, tempfile, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'bin', 'axiomcode')
LAUNCHER = os.path.join(ROOT, 'bin', 'axiomcode.js')
SERVER = os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'server.py')
TOOLS = {'axiomcode_index', 'axiomcode_context', 'axiomcode_path', 'axiomcode_impact',
         'axiomcode_changed', 'axiomcode_test_impact', 'axiomcode_graph'}
# every verb whose prose is paged (ax_pages.install) ends a long answer with "ask for page=2 (MCP)", so its tool has
# to accept one: a footer that points at a parameter the tool does not have strands the agent on page 1 (#1202)
PAGED = {'axiomcode_context', 'axiomcode_path', 'axiomcode_impact', 'axiomcode_changed', 'axiomcode_test_impact'}


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
         'params': {'name': 'axiomcode_path', 'arguments': {'from_': 'a', 'to': 'b', 'repo': cwd}}},
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

    A string sent for `targets: list[str]` was splatted into characters and impact answered about `u` (#1243).
    The well-formed calls are the control: each must NOT be refused, or a validator that refuses everything
    would pass."""
    bad = []
    wrong = [('axiomcode_impact', {'targets': 'Excluder.excludeClass', 'repo': cwd}, 'targets'),
             ('axiomcode_changed', {'repo': cwd, 'files': 'a.py'}, 'files'),
             ('axiomcode_impact', {'targets': ['A.f'], 'repo': cwd, 'depth': '2'}, 'depth'),
             ('axiomcode_impact', {'targets': ['A.f', 3], 'repo': cwd}, 'targets'),
             ('axiomcode_impact', {'repo': cwd}, 'targets'),
             ('axiomcode_path', {'from_': 'a', 'to': 'b', 'repo': cwd, 'nope': 1}, 'nope'),
             # a CLI flag's name sent as an argument (#1567): refused, naming the parameter it is here, not dropped
             # so that the unnarrowed answer came back as if it had been narrowed
             ('axiomcode_context', {'task': 'x', 'repo': cwd, 'in': 'src'}, 'is in_path= here'),
             ('axiomcode_impact', {'targets': ['A.f'], 'repo': cwd, 'tests_only': True}, 'is tests= here'),
             ('axiomcode_context', {'task': 'x', 'repo': cwd, 'from': 'main'}, 'is from_= here'),
             ('axiomcode_context', {'task': 'x', 'repo': cwd, 'lang': 'java'}, 'lang: unexpected argument')]
    for name, args, field in wrong:
        if lax and args.get('depth') == '2':
            continue                     # the SDK coerces the string "2" to 2 (pydantic's lax mode): harmless, not refused
        res = call(cmd, cwd, name, args)
        text = ' '.join(c.get('text', '') for c in res.get('content', []))
        # the fallback says "invalid arguments", the SDK's own validation "validation error"; both name the field
        if not res.get('isError') or field not in text or not ('invalid arguments' in text or 'validation error' in text):
            bad.append(f"{label}: {name}({json.dumps(args)}) was not refused naming {field!r}: {res}")
    # the control: every parameter a tool declares still passes, including the ones the CLI's hints name
    right = [('axiomcode_impact', {'targets': ['A.f'], 'repo': cwd, 'depth': 2, 'tests': True}),
             ('axiomcode_changed', {'repo': cwd, 'files': ['a.py']}),
             ('axiomcode_impact', {'targets': ['A.f'], 'repo': cwd, 'limit': 5, 'delete': True, 'in_path': 'src'}),
             ('axiomcode_context', {'task': 'x', 'repo': cwd, 'in_path': 'src', 'from_': 'main'}),
             ('axiomcode_context', {'task': 'x', 'repo': cwd, 'limit': 5}),
             ('axiomcode_path', {'from_': 'a', 'to': 'b', 'repo': cwd, 'limit': 3})]
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


def check_grep_default():
    """A list of sites comes one per line (--grep) by default; full=True, and every parameter asking for what only the
    prose carries (a flow's code, test routes, a delete verdict, a later page), gives the verb's own answer."""
    sys.path.insert(0, os.path.dirname(SERVER))
    import server
    seen = []
    real, server.run = server.run, (lambda args, *a, **k: seen.append(args) or '')
    try:
        grep = [lambda: server.axiomcode_impact(['A.f']), lambda: server.axiomcode_path('a', 'b'),
                lambda: server.axiomcode_context('how'), lambda: server.axiomcode_test_impact(),
                lambda: server.axiomcode_impact(['A.f'], tests=True, limit=5)]
        prose = [lambda: server.axiomcode_impact(['A.f'], full=True), lambda: server.axiomcode_impact(['A.f'], delete=True),
                 lambda: server.axiomcode_impact(['A.f'], why=True, tests=True), lambda: server.axiomcode_impact(['A.f'], page=2),
                 lambda: server.axiomcode_impact(['A.f'], page='all'), lambda: server.axiomcode_impact(['A.f'], page='2'),
                 lambda: server.axiomcode_path('a', 'b', full=True), lambda: server.axiomcode_context('how', source=True),
                 lambda: server.axiomcode_context('how', from_='main'), lambda: server.axiomcode_test_impact(why=True),
                 lambda: server.axiomcode_changed()]
        bad = []
        for f in grep:
            seen.clear(); f()
            if '--grep' not in seen[0]: bad.append(f"sites answer without --grep: {seen[0]}")
        # limit=N caps the sites on every tool whose footer says "limit=N lists more": context took no limit, and
        # test_impact's went to the prose's --limit, so the sites were never capped
        for f in (grep[-1], lambda: server.axiomcode_context('how', limit=5), lambda: server.axiomcode_test_impact(limit=5),
                  lambda: server.axiomcode_path('a', 'b', limit=5)):
            seen.clear(); f()
            if '--grep-limit' not in seen[0]: bad.append(f"limit=5 did not cap the sites: {seen[0]}")
            if '--limit' in seen[0]: bad.append(f"limit=5 passed as the prose's --limit under --grep: {seen[0]}")
        seen.clear(); server.axiomcode_test_impact(limit=5, why=True)       # the control: the prose keeps its --limit
        if '--limit' not in seen[0] or '--grep-limit' in seen[0]: bad.append(f"test_impact prose lost --limit: {seen[0]}")
        for f in prose:
            seen.clear(); f()
            if any(a.startswith('--grep') for a in seen[0]): bad.append(f"prose asked for, got --grep: {seen[0]}")
        # page="all" is what an answer's footer tells an MCP caller to send: it reaches the CLI as --page all, and the
        # SDK-free server's schema takes it as it takes a number (the control: a boolean is still refused)
        seen.clear(); server.axiomcode_impact(['A.f'], page='all')
        if '--page all' not in ' '.join(seen[0]): bad.append(f"page='all' did not ask for --page all: {seen[0]}")
        seen.clear(); server.axiomcode_impact(['A.f'], page=1)
        if '--page' in seen[0]: bad.append(f"page=1 passed --page: {seen[0]}")
        import _fallback
        sch = _fallback._schema_for(server.Page, 1)
        for v, ok in (('all', True), (2, True), (True, False)):
            if _fallback._conforms(v, sch) != ok: bad.append(f"fallback schema {sch} {'refused' if ok else 'took'} page={v!r}")
        return bad
    finally:
        server.run = real


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
    names = {t['name'] for t in replies.get(2, {}).get('result', {}).get('tools', [])}
    if names != TOOLS:
        bad.append(f"{label}: tools/list gave {sorted(names)}, want {sorted(TOOLS)}")
    unpaged = sorted(t['name'] for t in replies.get(2, {}).get('result', {}).get('tools', [])
                     if t['name'] in PAGED and 'page' not in (t.get('inputSchema') or {}).get('properties', {}))
    if unpaged:
        bad.append(f"{label}: paged answers whose tool takes no page: {unpaged}")
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
        bad += check_grep_default()
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
