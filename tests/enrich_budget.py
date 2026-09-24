#!/usr/bin/env python3
"""tests/enrich_budget.py — what the Read / Grep enrichment is allowed to cost a session (#1199).

enrich.py attaches a `graph:` block to a Read or a Grep of source. Each block is small, but a session reads a lot
and every block stays in context for the rest of it, so the hook holds itself to a per-session budget:

  · a declaration is annotated once a session, however its lines are reached again;
  · once the budget is spent it says so once, and then nothing;
  · the second half of the budget goes only to blocks with an edge into a file the agent has not opened.

Every silence below has its control: the same read in a fresh session DOES get a block, so a check cannot pass
because the hook had nothing to say. It indexes a small project, so it needs the engine, as run.py does.

    python3 tests/enrich_budget.py
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks', 'enrich.py')
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')

# A calls B; B calls back into A only; C calls D. Reading A then B: every edge of B ends in A, a file already open.
SRC = {
    'A.java': 'package app;\npublic class A {\n  public void a() { new B().b(); }\n  public void x() { }\n}\n',
    'B.java': 'package app;\npublic class B {\n  public void b() { new A().x(); }\n}\n',
    'C.java': 'package app;\npublic class C {\n  public void c() { new D().d(); }\n}\n',
    'D.java': 'package app;\npublic class D {\n  public void d() { }\n}\n',
}

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


def read(repo, session, name, budget=100000, **extra):
    """fire the hook as after a Read of src/app/<name>; the text the agent would receive"""
    fp = extra.pop('file_path', os.path.join(repo, 'src', 'app', name))
    ev = {'hook_event_name': 'PostToolUse', 'tool_name': 'Read', 'tool_input': dict({'file_path': fp}, **extra),
          'cwd': repo, 'session_id': session}
    env = dict(os.environ, AXIOMCODE_ENRICH_BUDGET=str(budget))
    r = subprocess.run([sys.executable, HOOK], input=json.dumps(ev), env=env, capture_output=True, text=True, timeout=120)
    out = r.stdout.strip()
    if not out:
        return ''
    try:
        return json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        return out


with tempfile.TemporaryDirectory() as repo:
    os.makedirs(os.path.join(repo, 'src', 'app'))
    for n, t in SRC.items():
        open(os.path.join(repo, 'src', 'app', n), 'w').write(t)
    built = subprocess.run(['bash', AX, 'index', repo, '--lang', 'java', '--src', 'src'], capture_output=True, text=True, timeout=1800)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        print('FAIL could not index the project; the engine is needed\n     ' + built.stderr.strip()[-300:])
        sys.exit(1)

    # ── a declaration is annotated once ─────────────────────────────────────────────────────────────────
    first = read(repo, 's1', 'A.java')
    check('a first read of source gets the edges its text does not show', 'graph:' in first and 'B.b' in first, first[:200])
    check('the same read again gets nothing', read(repo, 's1', 'A.java') == '')
    check('an overlapping range of the same lines gets nothing either (the key is the declaration, not the arguments)',
          read(repo, 's1', 'A.java', offset=2, limit=3) == '')
    check('nor does the same file reached through a relative path',
          read(repo, 's1', 'A.java', file_path='src/app/A.java') == '')
    check('control: a fresh session reading that range is annotated, so the silences above are the rule',
          'graph:' in read(repo, 's1b', 'A.java', offset=2, limit=3))

    # ── the second half of the budget goes to edges into unopened files ─────────────────────────────────
    spent = len(read(repo, 's2', 'A.java')) + 1                    # A: its edge into B, a file not opened yet
    half = 2 * spent - 2                                            # a budget whose first half that one block spent
    check('past half the budget, a read whose every edge ends in a file already opened gets nothing',
          read(repo, 's2', 'B.java', budget=half) == '')
    check('control: the same read of B in a fresh session is annotated, so it has edges to show',
          'graph:' in read(repo, 's2b', 'B.java', budget=half))
    c = read(repo, 's2', 'C.java', budget=half)
    check('past half the budget, a read with an edge into a file not yet opened still gets its block',
          'graph: C.java' in c and 'C.c' in c, c[:200])

    # ── spent means silent, after saying so once ────────────────────────────────────────────────────────
    read(repo, 's3', 'A.java', budget=1)
    said = read(repo, 's3', 'C.java', budget=1)
    check('once the budget is spent the hook says so, once, and names the verbs to ask instead',
          'budget' in said and 'impact' in said and 'B.b' not in said and 'D.d' not in said, said[:200])
    check('and after that it is silent', read(repo, 's3', 'D.java', budget=1) == '')
    check('control: that read of D is annotated in a session with budget left',
          'graph:' in read(repo, 's3b', 'D.java', budget=1))

print()
print(f"{len(checked) - len(fails)} of {len(checked)} check(s) held" if not fails else f"{len(fails)} FAILED: " + '; '.join(fails))
sys.exit(1 if fails else 0)
