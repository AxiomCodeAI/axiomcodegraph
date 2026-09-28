#!/usr/bin/env python3
"""ax_version.py: which BUILD of axiomcode this is, "0.1.6 (1a2b3c4d, 2026-09-28)".

Every build on a release branch carries the same package version, so the version alone could not tell an agent which
build answered it, or that a long-running MCP server was still serving the code it started with. The build is the
commit the package was built from and that commit's date, read from plugins/axiomcode/build-info.json, which
`npm run build` (and so `npm install` in a checkout and `npm pack`) writes with build-info.js --write. The stamp sits
inside the plugin because a host may install the plugin directory alone, and an install from the registry has no git.

A checkout whose HEAD has moved past the stamp says so: "(1a2b3c4d, 2026-09-28; source now at 5e6f7a8b)", since its
scripts run from the tree while the built parts are the stamped commit's. With no stamp, a checkout answers from git;
anything else prints the version alone. git is asked only when this package is the root of its repository, so a
plugin copied into some other project never reports that project's commit.

bin/axiomcode.js prints the same line from plugins/axiomcode/mcp/build-info.js (Node, for a machine without Python);
tests/cli_version.py holds the two to the same answer.

    python3 ax_version.py        print it
"""
import json, os, subprocess

PLUGIN = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
STAMP = 'build-info.json'


def _json(p):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _git_head(root):
    """(short commit, commit date) of root's HEAD when root is the top of its own git repository, else None."""
    try:
        top = subprocess.run(['git', '-C', root, 'rev-parse', '--show-toplevel'], capture_output=True, text=True, timeout=5)
        if top.returncode or os.path.realpath(top.stdout.strip()) != os.path.realpath(root):
            return None
        r = subprocess.run(['git', '-C', root, 'log', '-1', '--abbrev=8', '--format=%h %cs'],
                           capture_output=True, text=True, timeout=5)
        parts = r.stdout.split()
        return (parts[0], parts[1]) if not r.returncode and len(parts) == 2 else None
    except (OSError, subprocess.SubprocessError):
        return None


def build(plugin=PLUGIN):
    """{'version', 'commit', 'date', 'now'}: the stamp's build, and 'now' the checkout's HEAD when it differs."""
    root = os.path.dirname(os.path.dirname(plugin))
    info = _json(os.path.join(plugin, STAMP))
    version = (info.get('version') or _json(os.path.join(root, 'package.json')).get('version')
               or _json(os.path.join(plugin, '.claude-plugin', 'plugin.json')).get('version') or 'unknown')
    commit, date, now = info.get('commit'), info.get('date'), None
    head = _git_head(root) if os.path.isfile(os.path.join(root, 'package.json')) else None
    if head and not commit:
        commit, date = head
    elif head and not (head[0].startswith(commit) or commit.startswith(head[0])):
        now = head[0]
    return {'version': version, 'commit': commit, 'date': date, 'now': now}


def label(b=None):
    b = b or build()
    if not b.get('commit'):
        return b['version']
    return f"{b['version']} ({b['commit']}, {b['date'] or 'no date'}" + (f"; source now at {b['now']}" if b.get('now') else '') + ')'


if __name__ == '__main__':
    print(label())
