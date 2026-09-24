#!/usr/bin/env python3
"""tests/mcp.py — `axiomcode mcp` speaks MCP, from every way an agent can start it.

The package command is how every agent other than Claude Code reaches the tools: one line of MCP config,
`npx -y @axiomcode/code-graph mcp`, and no plugin install. That only holds if the command works where npm
puts it, so the server is started three ways and each has to answer `initialize`, list every tool, and
run one:

  bin/axiomcode mcp            the command itself
  <link>/axiomcode mcp         through a symlink, the way node_modules/.bin and a global install reach it
  python3 -S server.py         without site-packages, so the SDK cannot import and the built-in fallback
                               serves — the path a clean machine takes
  plugins/axiomcode/mcp.json   the portable plugin's own command, exactly as written, the three ways a host
                               can tell it where the plugin is: PLUGIN_ROOT in the environment (the portable
                               format's rule, Codex and Copilot), CLAUDE_PLUGIN_ROOT only, or nothing but the
                               plugin directory as the working directory (the format's default). The plugin sits
                               under a path with a space, which splits an unquoted path into two words

    python3 tests/mcp.py
"""
import json, os, shutil, subprocess, sys, tempfile, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'bin', 'axiomcode')
SERVER = os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'server.py')
TOOLS = {'axiomcode_index', 'axiomcode_context', 'axiomcode_path', 'axiomcode_impact',
         'axiomcode_changed', 'axiomcode_test_impact', 'axiomcode_graph'}


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


def check(label, cmd, cwd, env=None, workdir=None):
    replies, err = exchange(cmd, cwd, env, workdir)
    if replies is None:
        return [f"{label}: {err}"]
    bad = []
    init = replies.get(1, {}).get('result')
    if not init or 'serverInfo' not in init:
        bad.append(f"{label}: no initialize result (stderr: {err.strip()[:200]})")
    names = {t['name'] for t in replies.get(2, {}).get('result', {}).get('tools', [])}
    if names != TOOLS:
        bad.append(f"{label}: tools/list gave {sorted(names)}, want {sorted(TOOLS)}")
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
        os.symlink(CLI, link)
        bad += check('bin/axiomcode mcp', ['bash', CLI, 'mcp'], repo)
        bad += check('symlinked axiomcode mcp', [link, 'mcp'], repo)
        env_note = 'python3 -S server.py (fallback, no SDK)'
        bad += check(env_note, [sys.executable, '-S', SERVER], repo)

        # The portable manifest's server, run as its hosts run it. Hosts differ in how they say where the
        # plugin is, and a command that relies on one of them starts in that host only.
        plugin = os.path.join(work, 'plugin cache', 'axiomcode')
        shutil.copytree(os.path.join(ROOT, 'plugins', 'axiomcode'), plugin, symlinks=True)
        with open(os.path.join(plugin, 'mcp.json')) as f:
            server = json.load(f)['mcpServers']['axiomcode']
        cmd = [server['command'], *server['args']]
        base = {k: v for k, v in os.environ.items() if not k.endswith('PLUGIN_ROOT')}
        bad += check('mcp.json, PLUGIN_ROOT set', cmd, repo, dict(base, PLUGIN_ROOT=plugin), repo)
        bad += check('mcp.json, CLAUDE_PLUGIN_ROOT set', cmd, repo, dict(base, CLAUDE_PLUGIN_ROOT=plugin), repo)
        bad += check('mcp.json, plugin directory as cwd', cmd, repo, base, plugin)
    for b in bad:
        print('FAIL', b)
    print('ok' if not bad else f'{len(bad)} failure(s)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
