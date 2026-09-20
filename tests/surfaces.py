#!/usr/bin/env python3
"""tests/surfaces.py — every verb the dispatcher dispatches is documented on every caller-facing surface.

The defect this exists for (#1034): `context` and `test-impact` both worked, both documented themselves
properly under their own `--help`, and appeared on NONE of the surfaces a caller actually looks at. The
cause was three separate hand-maintained lists, none derived from the `case` statement that dispatches.
`axiomcode --help` is now derived from the dispatcher's own comment block, so it cannot drift; SKILL.md
and the MCP server still cannot be, and this is what says so out loud when one of them falls behind.

The fourth surface is `bin/axiomcode` — the command an install actually puts on $PATH (#1107). Every
query verb was implemented, shipped and unreachable from it, and `axiomcode path A B` was silently
taken for a build of a directory called `path`. That surface is checked BY RUNNING IT, not by reading
it: the verb must dispatch, not merely be mentioned.

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
CLI = os.path.join(ROOT, 'bin', 'axiomcode')     # the command an install puts on $PATH

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
    cli_help = subprocess.run(['bash', CLI, '--help'], capture_output=True, text=True).stdout
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
        if not re.search(r'^\s*axiomcode %s\b' % re.escape(v), cli_help, re.M):
            bad.append(f"{v}: not in `bin/axiomcode --help` — the installed command does not offer it")
        # RUN IT, THROUGH THE VERB'S OWN CASE. A verb listed in a help text and not dispatched is the
        # same defect wearing the opposite disguise. `axiomcode help <verb>` is NOT the check: it has
        # its own branch, and it kept answering while the verb dispatch beneath it was broken — which
        # is exactly the shape of #1107. So the installed command and the frontend are given the same
        # argv and must produce the same bytes; if bin/axiomcode handles the verb itself (or falls
        # through to a build) they differ.
        direct = subprocess.run(['bash', AX, v, '--help'], capture_output=True, text=True)
        viacli = subprocess.run(['bash', CLI, v, '--help'], capture_output=True, text=True)
        if (viacli.stdout, viacli.stderr) != (direct.stdout, direct.stderr):
            bad.append(f"{v}: `axiomcode {v}` does not reach the frontend — the installed command answers it itself")
        if len(direct.stdout.strip()) < 20:
            bad.append(f"{v}: the frontend prints no usage for it, so the comparison above proves nothing")

    # a typo must not be taken for a source tree (#1107): `*) cmd=all` used to make it one
    r = subprocess.run(['bash', CLI, 'impackt'], capture_output=True, text=True)
    if r.returncode == 0 or 'neither a verb nor a directory' not in r.stderr:
        bad.append("an unknown verb is not refused — it is still being taken for a build")
    print(f"dispatched verbs: {', '.join(vs)}  (surfaces: bin/axiomcode --help, its dispatch, skill --help, SKILL.md, MCP)")
    for b in bad: print("FAIL " + b)
    if bad:
        print(f"\n{len(bad)} surface(s) behind the dispatcher — document the verb, or add it to EXEMPT with the reason.")
        return 1
    print(f"ok — {len(vs)} verbs, every surface present (exemptions: " +
          ", ".join(f"{k}:{'/'.join(sorted(s))}" for k, s in EXEMPT.items() if s) + ")")
    return 0

if __name__ == '__main__':
    sys.exit(main())
