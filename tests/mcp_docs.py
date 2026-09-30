#!/usr/bin/env python3
"""tests/mcp_docs.py: every MCP argument the skill documents is one the tool it names accepts.

SKILL.md (and reference/*.md, when there is one) tells an agent which MCP arguments to pass (`find(question="…")`,
`impact(name="…")`, `path(start="…", end="…")`). An argument the tool's schema does not take is refused, and the agent
that followed the docs is left with an error and no answer. The docs name the arguments in prose, so this reads them the
way an agent does: in each paragraph, list item or table row that speaks of a tool, every `name=value` belongs to the
nearest tool named before it (`impact(`, MCP `impact`, `mcp__plugin_axiomcode_axiomcode__impact`; a run like "`impact`
and `path`" is one group, and every tool in it must take the argument). The schemas are the server's own tools/list, from the SDK-free
fallback, so what is checked is what a client is offered.

Both skill copies are read (plugins/axiomcode/skills/axiomcode and the root skills/axiomcode), and
plugins/axiomcode/AGENTS.md and rules/axiomcode.mdc, which name the same tools, and the block `axiomcode install` writes. An argument a schema
takes and the docs never mention is fine. A documented argument with no tool named before it is a failure too: the
agent cannot tell which tool takes it.

    python3 tests/mcp_docs.py
"""
import glob, json, os, re, subprocess, sys, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'server.py')
DOCS = sorted(p for d in (os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode'),
                          os.path.join(ROOT, 'skills', 'axiomcode'))
              for p in [os.path.join(d, 'SKILL.md')] + glob.glob(os.path.join(d, 'reference', '*.md'))) + \
       [os.path.join(ROOT, 'plugins', 'axiomcode', 'AGENTS.md')] + \
       sorted(glob.glob(os.path.join(ROOT, 'plugins', 'axiomcode', 'rules', '*.mdc')))
INSTALL = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode-install')

VERB = r'(find|impact|path|tests)'
# a tool named: a call `impact(`, the Claude Code name mcp__plugin_axiomcode_axiomcode__impact, MCP `impact`, or a command
# in backticks (`axiomcode impact x`); `path:line: …` is an answer's shape, not the tool
MENTION = re.compile(r'`(?:axiomcode )?' + VERB + r'(?:[ \t][^`\n]*)?`|\bmcp__plugin_axiomcode_axiomcode__' + VERB + r'\b'
                     r'|(?<![\w./-])' + VERB + r'\(')
# between two tools of one group: commas, "and", "or", a middle dot, a slash
JOIN = re.compile(r'^(?:[\s,·/]|\band\b|\bor\b)*$')
ARG = re.compile(r'(?<![\w.$\-])([a-z_][a-z0-9_]*)=(?!=)("[^"]*"|\'[^\']*\'|\[[^\]]*\]|[^\s`),;]*)')


def units(text):
    """paragraphs, with each list item and table row its own unit (a list item's indented lines stay with it)"""
    out, cur = [], []
    for line in text.split('\n'):
        starts = re.match(r'\s{0,3}(?:[-*] |\d+\. |\|)', line) or re.match(r'#', line)
        if not line.strip() or starts:
            if cur: out.append('\n'.join(cur))
            cur = []
        if line.strip(): cur.append(line)
    if cur: out.append('\n'.join(cur))
    return out


def documented(text):
    """(tool names or None, argument, value, the unit) for every argument documented for an MCP tool"""
    rows = []
    for u in units(text):
        if 'MCP' not in u and 'mcp__plugin_axiomcode' not in u and not re.search(r'(?<![\w./-])' + VERB + r'\(', u):
            continue
        groups = []                                         # [(start, end, {tools})]
        for m in MENTION.finditer(u):
            tool = m.group(1) or m.group(2) or m.group(3)
            if groups and JOIN.match(u[groups[-1][1]:m.start()]):
                groups[-1] = (groups[-1][0], m.end(), groups[-1][2] | {tool})
            else:
                groups.append((m.start(), m.end(), {tool}))
        for a in ARG.finditer(u):
            before = [g for g in groups if g[1] <= a.start()]
            rows.append((before[-1][2] if before else None, a.group(1), a.group(2), ' '.join(u.split())[:160]))
    return rows


def mismatches(rows, schemas, where):
    bad = []
    for tools, arg, val, unit in rows:
        if tools is None:
            bad.append(f"{where}: `{arg}={val}` names no MCP tool before it: {unit!r}")
            continue
        for t in sorted(tools):
            props = schemas.get(t)
            if props is None:
                bad.append(f"{where}: `{arg}={val}` is documented for {t}, which the server does not list")
            elif arg not in props:
                bad.append(f"{where}: `{arg}={val}` is documented for {t}, whose schema takes only {', '.join(props)}: {unit!r}")
            elif val in ('True', 'False', 'true', 'false') and props[arg].get('type') != 'boolean':
                bad.append(f"{where}: `{arg}={val}` is documented as a switch for {t}, whose schema types it {props[arg]}")
    return bad


def schemas():
    """the tools/list of the SDK-free fallback server: {tool: {argument: schema}}"""
    frames = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
               'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'tests', 'version': '0'}}},
              {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
              {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}]
    p = subprocess.Popen([sys.executable, '-S', SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, cwd=ROOT, text=True,
                         env=dict(os.environ, AXIOMCODE_REFRESH_INTERVAL='0'))
    timer = threading.Timer(60, p.kill)
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
                return {t['name']: (t.get('inputSchema') or {}).get('properties', {}) for t in m['result']['tools']}
        return {}
    finally:
        timer.cancel()
        p.stdin.close()
        p.wait()


def controls(tools):
    """the reader itself: a wrong argument is caught, a right one is not, and a group binds every tool in it"""
    bad = []
    fake = {'impact': {'name': {}}, 'path': {'start': {}, 'end': {}}, 'find': {'question': {}}, 'tests': {}}
    cases = [('MCP `impact` with `full=True`.', 1),                           # the argument the tool lacks
             ('MCP `impact` with `name=X`.', 0),                              # the near miss: it has it
             ('`path(start="a", end="b")` answers.', 0),
             ('The MCP `impact` and `path` answer; `start=a`.', 1),           # impact lacks it
             ('`find(question="x", limit=5)` lists more.', 1),
             ('mcp__plugin_axiomcode_axiomcode__tests with why=True.', 1),
             ('ask with `--fresh` (MCP `fresh=true`).', 1),                  # no tool named
             ('`path:line: code` then MCP `name=3`.', 1),                     # an answer's shape is not the tool
             ('A paragraph without the protocol: `timeout=14`.', 0)]           # not about MCP at all
    for text, want in cases:
        got = len(mismatches(documented(text), fake, 'control'))
        if got != want:
            bad.append(f"control {text!r}: {got} mismatch(es), want {want}")
    if set(tools) != {'find', 'impact', 'path', 'tests'}:
        bad.append(f"the server listed {sorted(tools)}; the MCP tools were not read")
    return bad


def main():
    tools = schemas()
    bad = controls(tools)
    seen = set()
    block = subprocess.run([sys.executable, INSTALL, '--print'], capture_output=True, text=True).stdout
    for path, text in [(p, open(p, encoding='utf-8').read()) for p in DOCS] + [('the install block', block)]:
        rel = os.path.relpath(path, ROOT) if os.path.isabs(path) else path
        rows = documented(text)
        seen |= {(t, a) for ts, a, _v, _u in rows if ts for t in ts}
        bad += mismatches(rows, tools, rel)
    # not a vacuous pass: the arguments the docs are known to teach were found and checked
    for want in (('find', 'question'), ('impact', 'name'), ('path', 'start'), ('path', 'end')):
        if want not in seen:
            bad.append(f"the docs' {want[0]} {want[1]}= was not found, so the reader missed it")
    print(f"{len(DOCS)} doc(s), {len(seen)} documented (tool, argument) pair(s) checked against {len(tools)} tool schema(s)")
    for b in bad:
        print('FAIL', b)
    print('ok' if not bad else f'{len(bad)} failure(s)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
