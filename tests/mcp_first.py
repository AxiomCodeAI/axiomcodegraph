#!/usr/bin/env python3
"""tests/mcp_first.py — every surface an agent reads before its first call names the MCP tool first (#1425).

`axiomcode install` pre-approves the plugin's MCP tools and nothing else. The skill's description, the
prompt-time orientation used to spell the call as a shell command, with the tool
in parentheses or not at all, so an agent took the shell spelling; under the install's permissions that first
call is the one that stops for a prompt, and in a headless session it is denied outright.

Each check is one surface: the tool's name comes before the shell form of the same verb. The control on every
surface is the other half: the shell form is still there, after it. A host without the MCP server, or a session
where the server did not start, has nothing else to call, and the skill has to keep working there.

    python3 tests/mcp_first.py      indexes one case, so it needs the engine, as hosts.py does
"""
import json, os, re, shutil, subprocess, sys, tempfile
# hook state lives in the temp directory, keyed on the session: a run of its own, or a second run of
# this script reusing the first run's session ids, must start clean
os.environ['TMPDIR'] = tempfile.mkdtemp(prefix='ax-hooks-')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUG = os.path.join(ROOT, 'plugins', 'axiomcode')
HOOKS = os.path.join(PLUG, 'hooks')
SCRIPTS = os.path.join(PLUG, 'skills', 'axiomcode', 'scripts')
AX = os.path.join(SCRIPTS, 'axiomcode')
CASE = os.path.join(ROOT, 'tests', 'cases', 'java', 'injected-into-a-field')

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


def tool_first(surface, text, verbs):
    """for each verb: the MCP tool is named (called, `impact(`, or by its Claude Code name), the shell form is named,
    and the tool comes first"""
    for v in verbs:
        tool, shell = f"{v}(", f"`axiomcode {v}"
        at = [m.start() for m in re.finditer(r'(?<![\w./`-])' + v + r'\(|mcp__plugin_axiomcode_axiomcode__' + v + r'\b', text)]
        t, s = (at[0] if at else -1), text.find(shell)
        check(f'{surface}: {v} is named as the {tool} tool', t >= 0, text[:200])
        check(f'{surface}: {v} keeps its shell form, for a host without the MCP server', s >= 0, text[:200])
        if t >= 0 and s >= 0:
            check(f'{surface}: {tool} comes before `axiomcode {v}`', t < s, f'tool at {t}, shell at {s}')


def fire(hook, ev):
    r = subprocess.run([sys.executable, os.path.join(HOOKS, hook)], input=json.dumps(ev),
                       capture_output=True, text=True, timeout=120)
    out = r.stdout.strip()
    try:
        return r.returncode, json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        return r.returncode, out


# 1. the description, which is the one part of the skill every session sees
skill = open(os.path.join(PLUG, 'skills', 'axiomcode', 'SKILL.md'), encoding='utf-8').read()
m = re.search(r'^description: >-\n(.*?)\n---', skill, re.S | re.M)
check('SKILL.md has a description block', bool(m))
if m:
    tool_first('SKILL.md description', ' '.join(m.group(1).split()), ('impact', 'path', 'tests'))

# 2. a search runs untouched: no PreToolUse hook is wired on Read, Grep, Glob or Bash — what the graph
# adds comes after, from the grep's own result (enrich.py's grep aid), feeding only what the search missed
hooks = json.load(open(os.path.join(HOOKS, 'hooks.json')))['hooks']
pre = ' '.join(g.get('matcher', '') for g in hooks.get('PreToolUse', []))
check('no PreToolUse hook speaks before a search (Read/Grep/Glob/Bash)',
      not re.search(r'\b(Read|Grep|Glob|Bash)\b', pre), pre)

# 3. the orientation on the first prompt, both branches it can reach: a change question and a how-question
with tempfile.TemporaryDirectory() as work:
    repo = os.path.join(work, 'case')
    shutil.copytree(CASE, repo)
    b = subprocess.run(['bash', AX, 'index', repo], capture_output=True, text=True, timeout=900)
    built = os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite'))
    check('the case indexes', built, (b.stdout + b.stderr)[-300:])
    if built:
        rc, said = fire('orient.py', {'hook_event_name': 'UserPromptSubmit', 'cwd': repo, 'session_id': 'o1',
                                      'prompt': 'What breaks if I change Repo.find and its callers?'})
        check('orient: a change question is oriented', rc == 0 and 'next,' in said, said[:300])
        tool_first('orient (change)', said, ('impact',))
        rc, said = fire('orient.py', {'hook_event_name': 'UserPromptSubmit', 'cwd': repo, 'session_id': 'o2',
                                      'prompt': 'How does Consumer.go work, step by step?'})
        check('orient: a how-question is oriented to the flow', rc == 0 and 'next:' in said, said[:300])
        tool_first('orient (how)', said, ('path',))

# 4. orient's third hint, for a verb that refuses without a scope: no verb refuses that way today, so it cannot be
# fired; the order is checked in the source line that prints it.
src = open(os.path.join(HOOKS, 'orient.py'), encoding='utf-8').read()
i = src.find("search these with grep as usual")
check('orient (scope refused): its hint is still in the source', i >= 0)
if i >= 0:
    tool_first('orient (scope refused)', src[i:src.find("')", src.find('`axiomcode impact', i))], ('impact',))

print(f'\n{len(checked) - len(fails)} of {len(checked)} check(s) held')
sys.exit(1 if fails else 0)
