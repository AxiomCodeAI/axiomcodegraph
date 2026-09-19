#!/usr/bin/env python3
"""tests/surfaces.py — every verb the dispatcher dispatches is documented on every caller-facing surface.

The defect this exists for (#1034): `context` and `test-impact` both worked, both documented themselves
properly under their own `--help`, and appeared on NONE of the surfaces a caller actually looks at. The
cause was three separate hand-maintained lists, none derived from the `case` statement that dispatches.
`axiomcode --help` is now derived from the dispatcher's own comment block, so it cannot drift; SKILL.md
and the MCP server still cannot be, and this is what says so out loud when one of them falls behind.

    python3 tests/surfaces.py

A verb that is deliberately not exposed on a surface goes in EXEMPT with the reason, so the exemption is
a written decision rather than a silent gap.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUG = os.path.join(ROOT, 'plugins', 'axiomcode')
AX = os.path.join(PLUG, 'skills', 'axiomcode', 'scripts', 'axiomcode')
SKILL = os.path.join(PLUG, 'skills', 'axiomcode', 'SKILL.md')
MCP = os.path.join(PLUG, 'mcp', 'server.py')

# verb -> surfaces it is deliberately absent from, and why
EXEMPT = {
    'install': {'mcp', 'skill_section'},   # writes CLAUDE.md once at setup; not a query an agent issues per turn
    'index':   {'skill_section'},          # covered by the Start here table and the four rules, not its own section
    'graph':   {'skill_section'},          # produces a page for a human, documented in Reference
    'changed': set(),
}

def verbs():
    """the dispatch table is the source of truth: the verbs of `case "$cmd" in`, aliases split out"""
    src = open(AX).read()
    body = src[src.index('case "$cmd" in'):src.index('\nesac')]
    out = []
    for m in re.finditer(r'^\s{2}([a-z][a-z|-]*)\)', body, re.M):
        out += [v for v in m.group(1).split('|')]
    return [v for v in out if v not in ('build', 'tests')]      # aliases of index / test-impact

def main():
    vs = verbs()
    help_txt = subprocess.run(['bash', AX, '--help'], capture_output=True, text=True).stdout
    skill = open(SKILL).read()
    mcp = open(MCP).read()
    bad = []
    for v in vs:
        ex = EXEMPT.get(v, set())
        if not re.search(r'^\s*axiomcode %s\b' % re.escape(v), help_txt, re.M):
            bad.append(f"{v}: not in `axiomcode --help`")
        if 'skill_section' not in ex and not re.search(r'^## .*\b%s\b' % re.escape(v), skill, re.M):
            bad.append(f"{v}: no SKILL.md section")
        if 'mcp' not in ex and f"def axiomcode_{v.replace('-', '_')}(" not in mcp:
            bad.append(f"{v}: no MCP tool axiomcode_{v.replace('-', '_')}")
    print(f"dispatched verbs: {', '.join(vs)}")
    for b in bad: print("FAIL " + b)
    if bad:
        print(f"\n{len(bad)} surface(s) behind the dispatcher — document the verb, or add it to EXEMPT with the reason.")
        return 1
    print(f"ok — {len(vs)} verbs, every surface present (exemptions: " +
          ", ".join(f"{k}:{'/'.join(sorted(s))}" for k, s in EXEMPT.items() if s) + ")")
    return 0

if __name__ == '__main__':
    sys.exit(main())
