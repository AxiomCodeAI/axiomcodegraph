#!/usr/bin/env python3
"""tests/surfaces.py — the public verbs are on every caller-facing surface, and nothing else is.

The product offers a small surface: `index` to set up, then four questions — `find`, `impact`, `path`, `tests` —
answered as numbered places with the code of the function each sits in. Every public verb must be:

  · in `axiomcode --help` (the dispatcher's own comment block) and in `bin/axiomcode --help`, the command an install
    puts on $PATH (#1107). That surface is checked BY RUNNING IT: the installed command and the frontend are given the
    same argv and must produce the same bytes, so a verb listed and not dispatched is caught;
  · a section of SKILL.md;
  · an MCP tool of the same name (index excepted: the first query builds the graph).

Every other verb the dispatcher still dispatches (the hooks, the suites and scripts call them with their flags) is
INTERNAL, with the reason written down, and must appear on none of those surfaces. A verb added to the dispatch table
that is in neither list fails, so exposing one is a decision rather than an accident (#1034).

The agent-facing docs (both copies of SKILL.md, AGENTS.md, the Cursor rule, the block `axiomcode install` writes, and
the README's CLI section) name no old MCP tool (`axiomcode_context` …) and no flag other than index's.

    python3 tests/surfaces.py
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUG = os.path.join(ROOT, 'plugins', 'axiomcode')
SCRIPTS = os.path.join(PLUG, 'skills', 'axiomcode', 'scripts')
AX = os.path.join(SCRIPTS, 'axiomcode')
SKILL = os.path.join(PLUG, 'skills', 'axiomcode', 'SKILL.md')
MCP = os.path.join(PLUG, 'mcp', 'server.py')
CLI = os.path.join(ROOT, 'bin', 'axiomcode')     # the command an install puts on $PATH

PUBLIC = ['index', 'find', 'impact', 'path', 'tests']
NO_MCP = {'index': 'setup, not a question: the first query through the MCP server builds the graph itself'}
# dispatched, not advertised: verb -> why
INTERNAL = {
    'build':       'the old name of index',
    'context':     'what find runs; its flags (--in, --source, --from, …) serve the hooks and the suites',
    'changed':     'impact with no name answers the same question at the front door; the edit hooks read it with --json',
    'test-impact': 'what tests runs; its flags (--range, --staged, --why, …) serve scripts and the suites',
    'graph':       'draws the graph as a page for a person; not one of the four questions',
    'diff':        'compares two graphs of one tree; a tool for checking an engine change',
    'install':     'writes the CLAUDE.md block once, at setup',
}
OLD_TOOLS = re.compile(r'\baxiomcode_(context|impact|path|changed|test_impact|graph|index|diff)\b')
INDEX_FLAGS = {'--lang', '--src', '--library'}


def dispatched():
    """the verbs of the dispatch table, as the dispatcher itself lists them (`--verbs`)"""
    return subprocess.run(['bash', AX, '--verbs'], capture_output=True, text=True).stdout.split()


def advertised(help_text):
    return re.findall(r'^\s*axiomcode ([a-z][a-z-]*)\b', help_text, re.M)


def readme_cli():
    text = open(os.path.join(ROOT, 'README.md'), encoding='utf-8').read()
    i = text.index('## CLI commands')
    return text[i:text.index('\n## ', i + 1)]


def docs():
    """(label, text) of every agent-facing text that teaches the surface"""
    out = []
    for p in (SKILL, os.path.join(ROOT, 'skills', 'axiomcode', 'SKILL.md'), os.path.join(PLUG, 'AGENTS.md'),
              os.path.join(PLUG, 'rules', 'axiomcode.mdc')):
        out.append((os.path.relpath(p, ROOT), open(p, encoding='utf-8').read()))
    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'axiomcode-install'), '--print'], capture_output=True, text=True)
    out.append(('the install block', r.stdout))
    out.append(('README.md CLI section', readme_cli()))
    return out


def doc_findings(label, text):
    bad = []
    for m in OLD_TOOLS.finditer(text):
        bad.append(f"{label}: names the old MCP tool {m.group(0)}")
    for flag in sorted(set(re.findall(r'(?<![\w-])--[a-z][a-z-]*', text)) - INDEX_FLAGS):
        bad.append(f"{label}: names the flag {flag}")
    return bad


def controls():
    """the doc reader itself: an old tool and a flag are caught, index's flags and a plain dash are not"""
    bad = []
    for text, want in (('ask `axiomcode_context` first', 1), ('pass `--fresh` to wait', 1),
                       ('`axiomcode index --lang java --src src`', 0), ('find — where the code lives', 0),
                       ('mcp__plugin_axiomcode_axiomcode__find', 0)):
        got = len(doc_findings('control', text))
        if got != want: bad.append(f"control {text!r}: {got} finding(s), want {want}")
    return bad


def main():
    vs = dispatched()
    help_txt = subprocess.run(['bash', AX, '--help'], capture_output=True, text=True).stdout
    cli_help = subprocess.run(['bash', CLI, '--help'], capture_output=True, text=True).stdout
    skill = open(SKILL).read()
    mcp = open(MCP).read()
    tools = set(re.findall(r'^def (\w+)\(', mcp[mcp.index('@srv.tool()'):], re.M)) if '@srv.tool()' in mcp else set()
    bad = controls()
    if not vs: bad.append("the dispatcher listed no verbs, so nothing below was checked")
    for v in vs:
        if v not in PUBLIC and v not in INTERNAL:
            bad.append(f"{v}: dispatched but neither public nor INTERNAL — expose it, or write down why it is internal")
    for label, text in (('axiomcode --help', help_txt), ('bin/axiomcode --help', cli_help)):
        if advertised(text) != [v for v in advertised(text) if v in PUBLIC] or sorted(set(advertised(text))) != sorted(PUBLIC):
            bad.append(f"{label} advertises {advertised(text)}, want exactly {PUBLIC}")
        for flag in sorted(set(re.findall(r'(?<![\w-])--[a-z][a-z-]*', text)) - INDEX_FLAGS):
            bad.append(f"{label}: names the flag {flag}")
    for v in PUBLIC:
        if v not in vs: bad.append(f"{v}: public, and the dispatcher does not dispatch it")
        if not re.search(r'^## .*\b%s\b' % re.escape(v), skill, re.M):
            bad.append(f"{v}: no SKILL.md section")
        if v not in NO_MCP and v not in tools:
            bad.append(f"{v}: no MCP tool {v}")
        # RUN IT, THROUGH THE VERB'S OWN CASE: `axiomcode help <verb>` has its own branch and kept answering while the
        # dispatch beneath it was broken (#1107), so the installed command and the frontend get the same argv
        direct = subprocess.run(['bash', AX, v, '--help'], capture_output=True, text=True)
        viacli = subprocess.run(['bash', CLI, v, '--help'], capture_output=True, text=True)
        if (viacli.stdout, viacli.stderr) != (direct.stdout, direct.stderr):
            bad.append(f"{v}: `axiomcode {v}` does not reach the frontend — the installed command answers it itself")
        if len(direct.stdout.strip()) < 20:
            bad.append(f"{v}: the frontend prints no usage for it, so the comparison above proves nothing")
    for v in INTERNAL:
        if v in tools: bad.append(f"{v}: internal, and still an MCP tool")
        if re.search(r'^## .*\b%s\b' % re.escape(v), skill, re.M): bad.append(f"{v}: internal, and still a SKILL.md section")
    if tools != {v for v in PUBLIC if v not in NO_MCP}:
        bad.append(f"the MCP tools are {sorted(tools)}, want {sorted(v for v in PUBLIC if v not in NO_MCP)}")
    for label, text in docs():
        bad += doc_findings(label, text)

    # a typo must not be taken for a source tree (#1107), and the verbs it offers are the public ones
    r = subprocess.run(['bash', CLI, 'impackt'], capture_output=True, text=True)
    if r.returncode == 0 or 'neither a verb nor a directory' not in r.stderr:
        bad.append("an unknown verb is not refused — it is still being taken for a build")
    offered = next((l.split(':', 1)[1].split() for l in r.stderr.splitlines() if l.strip().startswith('ask:')), [])
    if sorted(offered) != sorted(PUBLIC):
        bad.append(f"a typo is offered {offered}, want the public verbs {PUBLIC}")
    # THE FRONTMATTER IS YAML, AND NOT EVERY READER IS LENIENT. A plain scalar may not contain `: ` or ` #`:
    # strict parsers read the first as a nested mapping and the second as a comment, so the description
    # that decides when the skill fires fails to load wherever the file is parsed properly. Checked without PyYAML:
    # a value that is quoted or a block scalar (`>`, `|`) is left alone.
    fm = skill.split('---', 2)[1] if skill.startswith('---') else ''
    for line in fm.splitlines():
        m = re.match(r'^([A-Za-z_-]+):[ \t]+(.*)$', line)
        if m and not m.group(2).startswith(('"', "'", '>', '|')) and re.search(r': | #', m.group(2)):
            bad.append(f"SKILL.md frontmatter: `{m.group(1)}` is a plain YAML scalar containing ': ' or ' #' — "
                       f"quote it or make it a block scalar (`{m.group(1)}: >-`)")
    print(f"dispatched verbs: {', '.join(vs)}; public: {', '.join(PUBLIC)}; MCP tools: {', '.join(sorted(tools))}")
    for b in bad: print("FAIL " + b)
    if bad:
        print(f"\n{len(bad)} failure(s)")
        return 1
    print(f"ok — {len(PUBLIC)} public verbs on every surface, {len(INTERNAL)} internal verbs on none")
    return 0

if __name__ == '__main__':
    sys.exit(main())
