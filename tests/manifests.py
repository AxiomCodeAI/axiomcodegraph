#!/usr/bin/env python3
"""tests/manifests.py — every agent's manifest names the same plugin and points at files that exist.

One plugin directory, plugins/axiomcode/, is installed by every host below, each reading the first manifest
it knows:

  Claude Code, Cursor, Devin      .claude-plugin/marketplace.json -> plugins/axiomcode/.claude-plugin/plugin.json + .mcp.json
  Codex, Copilot CLI, VS Code,    plugins/axiomcode/plugin.json + mcp.json, the portable Agent Plugins format;
  Kiro                            Codex finds it through .agents/plugins/marketplace.json, Copilot through the
                                  Claude marketplace, and each prefers it to its own manifest
  Codex before the portable       plugins/axiomcode/.codex-plugin/plugin.json
  format
  Gemini CLI                      gemini-extension.json and skills/, at the repository root

The hosts start the MCP server differently, and a manifest that points at a moved file installs cleanly and
fails only when the agent first calls a tool. So every path each manifest names is resolved the way that
host resolves it and must exist, and the name and version must agree everywhere:

  Claude Code and Copilot expand ${CLAUDE_PLUGIN_ROOT} to the plugin directory.
  Codex reading .codex-plugin/ expands nothing in a plugin's MCP config, sets no variable, and resolves a
  relative `cwd` against the plugin directory, so that server is started by a relative path from `"cwd": "."`.
  Reading the portable format, it expands ${PLUGIN_ROOT} and sets PLUGIN_ROOT, as the format requires.
  Gemini expands ${extensionPath} to the repository root and ${/} to the path separator, and finds skills
  only in skills/ at that root, so skills/axiomcode/ holds a copy of the skill's text (packaging/root-skill.py).
  The portable format's schema is closed and its mcp.json takes a single executable as `command`; hosts
  reject a manifest that breaks either rule. How a host says where the plugin is differs (PLUGIN_ROOT,
  CLAUDE_PLUGIN_ROOT, or only the working directory), which tests/mcp.py runs.

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
        script = next((a for a in server.get('args', []) if a.endswith('.sh') or a.endswith('.py')), None)
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

    # The portable format: a closed manifest schema, the fields Kiro requires to list a Power, and an
    # mcp.json whose server is a single executable with no host variable the format does not define.
    portable = load('plugins', 'axiomcode', 'plugin.json')
    allowed = {'$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license',
               'keywords', 'extensions'}
    if portable.get('$schema') != 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json':
        bad.append(f"plugin.json: $schema {portable.get('$schema')!r} is not Agent Plugins 1.0.0")
    for key in sorted(set(portable) - allowed):
        bad.append(f"plugin.json: {key} is not a field of the portable manifest")
    for key in ('name', 'version', 'description', 'author', 'keywords'):
        if not portable.get(key):
            bad.append(f"plugin.json: {key} is missing (Kiro requires it)")
    if portable.get('name') != 'axiomcode' or portable.get('version') != package['version']:
        bad.append(f"plugin.json: name/version {portable.get('name')!r} {portable.get('version')!r} do not match")
    mcp = load('plugins', 'axiomcode', 'mcp.json')
    if mcp.get('$schema') != 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' or set(mcp) != {'$schema', 'mcpServers'}:
        bad.append("mcp.json: needs exactly $schema (Agent Plugins 1.0.0) and mcpServers")
    for name, server in mcp.get('mcpServers', {}).items():
        if server.get('type') != 'stdio' or set(server) - {'type', 'command', 'args', 'env', 'cwd'}:
            bad.append(f"mcp.json {name}: not a stdio server of the portable format")
        if not re.fullmatch(r'[\w.-]+', server.get('command', '')):
            bad.append(f"mcp.json {name}: command {server.get('command')!r} is not a single executable name")
        if {'PLUGIN_ROOT', 'PLUGIN_DATA'} & set(server.get('env', {})):
            bad.append(f"mcp.json {name}: env must not set PLUGIN_ROOT or PLUGIN_DATA; the host does")

    # Gemini: skills/axiomcode/ at the repository root is a current copy of the plugin's skill text.
    sync = subprocess.run([sys.executable, os.path.join(ROOT, 'packaging', 'root-skill.py'), '--check'],
                          capture_output=True, text=True)
    if sync.returncode:
        bad += [line for line in sync.stdout.splitlines() if line] or ["skills/axiomcode/: stale"]

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
