#!/usr/bin/env python3
"""tests/manifests.py — every agent's manifest names the same plugin and points at files that exist.

One plugin directory, plugins/axiomcode/, is installed by every host below, each reading the first manifest
it knows:

  Claude Code, Copilot CLI,       .claude-plugin/marketplace.json -> plugins/axiomcode/.claude-plugin/plugin.json + .mcp.json
  VS Code, Devin
  Codex                           .agents/plugins/marketplace.json -> plugins/axiomcode/.codex-plugin/plugin.json, whose
                                  skills, mcpServers and hooks name the shared files. There is deliberately no root
                                  plugin.json: Codex prefers one to .codex-plugin/ and then loads no plugin hooks
  Gemini CLI                      gemini-extension.json and skills/, at the repository root
  Cursor                          .cursor-plugin/marketplace.json -> plugins/axiomcode/.cursor-plugin/plugin.json,
                                  which it prefers to .claude-plugin/; skills/, rules/ and hooks/ by folder

The hosts start the MCP server differently, and a manifest that points at a moved file installs cleanly and
fails only when the agent first calls a tool. So every path each manifest names is resolved the way that
host resolves it and must exist, and the name and version must agree everywhere:

  Claude Code and Copilot expand ${CLAUDE_PLUGIN_ROOT} to the plugin directory.
  Codex reading .codex-plugin/ expands nothing in a plugin's MCP config, sets no variable, and resolves a
  relative `cwd` against the plugin directory, so that server is started by a relative path from `"cwd": "."`.
  Its hooks run with CLAUDE_PLUGIN_ROOT, PLUGIN_ROOT and PLUGIN_DATA set, so hooks.json serves it unchanged.
  Cursor expands ${CURSOR_PLUGIN_ROOT} and ${CLAUDE_PLUGIN_ROOT}, and its manifest names the server itself. Its logo and every path are relative to the
  plugin directory, with no `..`, as its marketplace review requires.
  Gemini expands ${extensionPath} to the repository root and ${/} to the path separator, and finds skills
  only in skills/ at that root, so skills/axiomcode/ holds a copy of the skill's text (packaging/copies.py).
  No server is started by `bash` or `python3`: on Windows a bare `bash` is WSL's or nothing and `python3`
  is a Store placeholder, and a manifest has no per-platform variant, so every one starts `node` (#1233).

    python3 tests/manifests.py
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(ROOT, 'plugins', 'axiomcode')


def load(*parts):
    with open(os.path.join(ROOT, *parts)) as f:
        return json.load(f)


def main():
    bad = []
    package = load('package.json')
    claude_market = load('.claude-plugin', 'marketplace.json')
    claude = load('plugins', 'axiomcode', '.claude-plugin', 'plugin.json')
    codex_market = load('.agents', 'plugins', 'marketplace.json')
    codex = load('plugins', 'axiomcode', '.codex-plugin', 'plugin.json')
    gemini = load('gemini-extension.json')

    for label, m in [('claude plugin.json', claude), ('codex plugin.json', codex), ('gemini-extension.json', gemini)]:
        if m.get('name') != 'axiomcode':
            bad.append(f"{label}: name is {m.get('name')!r}, want 'axiomcode'")
        if m.get('version') != package['version']:
            bad.append(f"{label}: version {m.get('version')!r} differs from package.json {package['version']!r}")

    # Both marketplaces must lead to the one plugin directory.
    claude_src = claude_market['plugins'][0]['source']
    codex_src = codex_market['plugins'][0]['source'].get('path')
    for label, src in [('claude marketplace', claude_src), ('codex marketplace', codex_src)]:
        if os.path.normpath(os.path.join(ROOT, src or '')) != PLUGIN:
            bad.append(f"{label}: source {src!r} is not plugins/axiomcode")

    # Claude Code and Copilot: ${CLAUDE_PLUGIN_ROOT} is the plugin directory.
    for name, server in load('plugins', 'axiomcode', '.mcp.json')['mcpServers'].items():
        for arg in server.get('args', []):
            path = arg.replace('${CLAUDE_PLUGIN_ROOT}', PLUGIN)
            if arg != path and not os.path.isfile(path):
                bad.append(f".mcp.json {name}: {arg} does not exist")

    # Codex: paths in its plugin.json are relative to the plugin directory.
    for key in ('skills', 'mcpServers', 'hooks'):
        if key in codex and not os.path.exists(os.path.join(PLUGIN, codex[key])):
            bad.append(f"codex plugin.json {key}: {codex[key]} does not exist")
    for name, server in load('plugins', 'axiomcode', codex['mcpServers'])['mcpServers'].items():
        if '${' in json.dumps(server):
            bad.append(f"codex mcp {name}: Codex does not expand ${{…}} in a plugin's MCP config")
        cwd = os.path.join(PLUGIN, server.get('cwd', ''))
        script = next((a for a in server.get('args', []) if a.endswith(('.js', '.sh', '.py'))), None)
        if not script or not os.path.isfile(os.path.join(cwd, script)):
            bad.append(f"codex mcp {name}: {script} does not exist relative to cwd {server.get('cwd')!r}")

    # Gemini: ${extensionPath} is the repository root.
    def gemini_path(value):
        return value.replace('${extensionPath}', ROOT).replace('${/}', os.sep)
    if not os.path.isfile(os.path.join(ROOT, gemini.get('contextFileName', ''))):
        bad.append(f"gemini-extension.json: contextFileName {gemini.get('contextFileName')!r} does not exist")
    for name, server in gemini.get('mcpServers', {}).items():
        for arg in server.get('args', []):
            if '${extensionPath}' in arg and not os.path.isfile(gemini_path(arg)):
                bad.append(f"gemini mcp {name}: {arg} does not exist")
        root = server.get('env', {}).get('AXIOMCODE_PLUGIN_ROOT')
        if root and os.path.normpath(gemini_path(root)) != PLUGIN:
            bad.append(f"gemini mcp {name}: AXIOMCODE_PLUGIN_ROOT {root} is not plugins/axiomcode")

    # Codex loads plugin hooks only from .codex-plugin/plugin.json, and only when no root plugin.json exists.
    if 'hooks' not in codex:
        bad.append("codex plugin.json: no hooks field, so Codex runs none of the hooks")
    if os.path.exists(os.path.join(PLUGIN, 'plugin.json')):
        bad.append("plugins/axiomcode/plugin.json exists: Codex would read it instead of .codex-plugin/ and load no hooks")
    for event, groups in load('plugins', 'axiomcode', 'hooks', 'hooks.json')['hooks'].items():
        for group in groups:
            for hook in group['hooks']:
                script = re.search(r'\$\{CLAUDE_PLUGIN_ROOT\}(/[^"\s]+)', hook['command'])
                if not script or not os.path.isfile(PLUGIN + script.group(1)):
                    bad.append(f"hooks.json {event}: {hook['command']!r} names no script that exists")

    # Cursor: its marketplace leads to the plugin, and its manifest agrees with the others and names files
    # that exist once ${CURSOR_PLUGIN_ROOT} is the plugin directory.
    cursor_market = load('.cursor-plugin', 'marketplace.json')
    cursor = load('plugins', 'axiomcode', '.cursor-plugin', 'plugin.json')
    if os.path.normpath(os.path.join(ROOT, cursor_market['plugins'][0]['source'])) != PLUGIN:
        bad.append(f"cursor marketplace: source {cursor_market['plugins'][0]['source']!r} is not plugins/axiomcode")
    if cursor.get('name') != 'axiomcode' or cursor.get('version') != package['version']:
        bad.append(f"cursor plugin.json: name/version {cursor.get('name')!r} {cursor.get('version')!r} do not match")
    if cursor.get('license') != package.get('license'):
        bad.append(f"cursor plugin.json: license {cursor.get('license')!r} differs from package.json")
    logo = cursor.get('logo', '')
    if not logo or '..' in logo or os.path.isabs(logo) or not os.path.isfile(os.path.join(PLUGIN, logo)):
        bad.append(f"cursor plugin.json: logo {logo!r} is not a file relative to the plugin")
    for name, server in cursor.get('mcpServers', {}).items():
        for arg in server.get('args', []):
            path = arg.replace('${CURSOR_PLUGIN_ROOT}', PLUGIN)
            if arg != path and not os.path.isfile(path):
                bad.append(f"cursor plugin.json {name}: {arg} does not exist")
        if '${PLUGIN_ROOT}' in json.dumps(server):
            bad.append(f"cursor plugin.json {name}: Cursor does not expand ${{PLUGIN_ROOT}}")

    # One command name that means the same program on every platform (#1233).
    servers = [('.mcp.json', load('plugins', 'axiomcode', '.mcp.json')),
               ('codex mcp', load('plugins', 'axiomcode', codex['mcpServers'])), ('gemini-extension.json', gemini),
               ('cursor plugin.json', cursor)]
    for label, m in servers:
        for name, server in m.get('mcpServers', {}).items():
            if server.get('command') != 'node':
                bad.append(f"{label} {name}: command {server.get('command')!r}, want 'node'; bash and python3 "
                           "resolve to the wrong program or none on Windows")

    # Gemini runs <root>/hooks/hooks.json under its own event names; every script it names must exist once
    # ${extensionPath} is the repository root.
    gemini_hooks = load('hooks', 'hooks.json')['hooks']
    for event in sorted(set(gemini_hooks) - {'BeforeAgent', 'BeforeTool', 'AfterTool', 'SessionStart', 'AfterAgent'}):
        bad.append(f"hooks/hooks.json: {event} is not a Gemini CLI event")
    for event, groups in gemini_hooks.items():
        for group in groups:
            for hook in group['hooks']:
                script = re.search(r'"([^"]+\.py)"', hook['command'])
                if not script or not os.path.isfile(gemini_path(script.group(1))):
                    bad.append(f"hooks/hooks.json {event}: {hook['command']!r} names no script that exists")

    # Gemini's copy of the skill and Cursor's rule are current copies of their sources.
    sync = subprocess.run([sys.executable, os.path.join(ROOT, 'packaging', 'copies.py'), '--check'],
                          capture_output=True, text=True)
    if sync.returncode:
        bad += [line for line in sync.stdout.splitlines() if line] or ["packaging/copies.py --check failed"]

    # Hook commands run through a shell. An unquoted ${CLAUDE_PLUGIN_ROOT} splits at a space in the install
    # path, python3 exits 2, and exit 2 from PreToolUse blocks the tool call it was meant to enrich.
    for event, groups in load('plugins', 'axiomcode', 'hooks', 'hooks.json')['hooks'].items():
        for group in groups:
            for hook in group['hooks']:
                if re.search(r'(?<!")\$\{CLAUDE_PLUGIN_ROOT\}', hook['command']):
                    bad.append(f"hooks.json {event}: {hook['command']!r} leaves ${{CLAUDE_PLUGIN_ROOT}} unquoted")

    # Every host is told about the same seven tools.
    server = open(os.path.join(PLUGIN, 'mcp', 'server.py')).read()
    tools = set(re.findall(r'^def (axiomcode_\w+)\(', server, re.M))
    context = open(os.path.join(ROOT, gemini['contextFileName'])).read()
    for tool in sorted(tools - set(re.findall(r'\b(axiomcode_\w+)\b', context))):
        bad.append(f"{gemini['contextFileName']}: does not name the {tool} tool")

    for b in bad:
        print('FAIL', b)
    print('ok' if not bad else f'{len(bad)} failure(s)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
