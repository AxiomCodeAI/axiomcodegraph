#!/usr/bin/env python3
"""tests/directive.py — the PreToolUse directive hook, checked on the promises it makes.

This hook runs before EVERY Read, Grep, Glob and Bash in any repository that has a graph. That reach is
the reason it is worth having and the reason it is worth pinning: a hook that raises, blocks, or speaks
when it has nothing to say costs every agent using the plugin something, on every turn.

Each check names the promise rather than the code path, so a failure here says which promise broke.
"""
import json, os, sqlite3, subprocess, sys, tempfile

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    '..', 'plugins', 'axiomcode', 'hooks', 'direct.py')
TMP = tempfile.mkdtemp()                                   # where the per-session stamps go: a clean one per run


def fire(repo, tool, inp, session='s1'):
    ev = json.dumps({'tool_name': tool, 'tool_input': inp, 'cwd': repo, 'session_id': session})
    r = subprocess.run([sys.executable, HOOK], input=ev, capture_output=True, text=True, timeout=20,
                       env={**os.environ, 'TMPDIR': TMP})
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def ctx(out):
    if not out:
        return None
    return json.loads(out)['hookSpecificOutput']['additionalContext']


def graph(repo, rows):
    """a graph.sqlite with just the symbols table the hook reads: (name, display, kind, file, line)"""
    os.makedirs(os.path.join(repo, '.axiomcode', 'out'), exist_ok=True)
    con = sqlite3.connect(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite'))
    con.execute("CREATE TABLE symbols(id TEXT, name TEXT, display TEXT, kind TEXT, file TEXT, line INT, is_test INT, method_id TEXT)")
    con.executemany("INSERT INTO symbols VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
                    [(d, n, d, k, f, l, d if k in ('method', 'function') else None) for n, d, k, f, l in rows])
    con.commit(); con.close()


fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


ROWS = [('doWork', 'Worker.doWork', 'method', 'src/Worker.java', 7), ('Worker', 'Worker', 'class', 'src/Worker.java', 3),
        ('work', 'work', 'function', 'src/util.py', 1), ('maxRetries', 'Worker.maxRetries', 'field', 'src/Worker.java', 4),
        ('render', 'render', 'function', 'src/a.py', 2), ('render', 'View.render', 'method', 'lib/view.py', 5)] + \
       [('handle', f'H{i}.handle', 'method', f'src/H{i}.java', 3) for i in range(8)]

with tempfile.TemporaryDirectory() as repo, tempfile.TemporaryDirectory() as other:
    os.makedirs(os.path.join(repo, 'src'))
    os.makedirs(os.path.join(repo, 'lib'))
    open(os.path.join(repo, 'src', 'Worker.java'), 'w').write('class Worker { int maxRetries; void doWork(){} }\n')
    open(os.path.join(repo, 'NOTES.md'), 'w').write('doWork\n')

    rc, out, err = fire(repo, 'Grep', {'pattern': 'doWork'})
    check('a repository with no graph hears nothing, because the verbs could not answer anyway',
          rc == 0 and out == '', f'rc={rc} out={out[:120]}')

    graph(repo, ROWS)
    graph(other, [('handle', 'Router.handle', 'method', 'lib/router.js', 9), ('Router', 'Router', 'class', 'lib/router.js', 2)])

    rc, out, _ = fire(repo, 'Grep', {'pattern': 'TODO|use strict'})
    check('CONTROL: a search that names nothing the graph declares hears nothing (the generic text was acted on 0%)',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': 'maxRetries'})
    check('CONTROL: a field shares its name with too much config to be the question, so it is not named',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': r'doWork\('})
    first = ctx(out)
    check('a search for a declared method is told that declaration, where it is, and the impact call for it',
          rc == 0 and first and 'Worker.doWork' in first and 'src/Worker.java:7' in first and 'axiomcode_impact' in first
          and 'never spell the name' in first, f'out={out[:300]}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': 'Worker'})
    check('said once per session: a later search for another declaration in the same session hears nothing more',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(other, 'Grep', {'pattern': 'Router', 'path': other})
    check('once per session means per SESSION: a search in another indexed repository hears nothing more either',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(other, 'Grep', {'pattern': 'Router', 'path': other}, session='s2')
    check('a new session is told again, naming the declaration in the repository it searches',
          rc == 0 and ctx(out) and 'Router' in ctx(out) and 'lib/router.js:2' in ctx(out), f'out={out[:200]}')

    rc, out, _ = fire(repo, 'Read', {'file_path': os.path.join(repo, 'src', 'Worker.java')}, session='s3')
    check('a Read of a file already chosen is not a search and hears nothing',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Bash', {'command': 'git status'}, session='s3')
    check('a shell command that is not a search is not the decision this is about',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Bash', {'command': 'npm test 2>&1 | grep doWork'}, session='s3')
    check('a grep filtering another command\'s output is not a code search',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Bash', {'command': 'grep -n doWork NOTES.md'}, session='s3')
    check('a shell search of a file that is not source is not the decision this is about',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Bash', {'command': 'grep -rn work src'}, session='s3')
    check('CONTROL: a plain lowercase word is as likely prose as a name, and is not named',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Bash', {'command': f'cd {repo} && grep -rn "def work(" src'}, session='s3')
    check('the same word written as code (`def work(`) is a name, and a shell search for it is told',
          rc == 0 and ctx(out) and 'src/util.py:1' in ctx(out), f'out={out[:200]}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': r'expr_call\("work"'}, session='s3')
    check('CONTROL: a lowercase word that is a string inside code (`expr_call("work"`) is not named, though code is near it',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': r'\.handle\('}, session='s3')
    check('CONTROL: a name declared in more than a handful of places says nothing about which one, and is not named',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': r'^\.work ref|\.work\b'}, session='s3')
    check('CONTROL: a lowercase word behind a dot alone (`\\.json`, a Datalog `.decl`) is an extension or a directive, not named',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': r'\.work\('}, session='s10')
    check('the same word called behind a dot (`.work(`) is a name, and is told',
          rc == 0 and ctx(out) and 'src/util.py:1' in ctx(out), f'out={out[:200]}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': 'def render(', 'path': 'lib'}, session='s9')
    check('the declaration inside the searched path is the one named, not the first in the repository',
          rc == 0 and ctx(out) and 'lib/view.py:5' in ctx(out) and 'src/' not in ctx(out), f'out={out[:200]}')

    rc, out, _ = fire(repo, 'mcp__plugin_axiomcode_axiomcode__axiomcode_impact', {'targets': ['Worker.doWork']}, session='s4')
    rc2, out2, _ = fire(repo, 'Grep', {'pattern': 'doWork'}, session='s4')
    check('an agent that already called the graph through MCP is not told about it afterwards',
          rc == 0 and out == '' and rc2 == 0 and out2 == '', f'out={out2[:120]}')

    rc, out, _ = fire(repo, 'Bash', {'command': 'axiomcode impact Worker.doWork'}, session='s5')
    rc2, out2, _ = fire(repo, 'Grep', {'pattern': 'doWork'}, session='s5')
    check('an agent already calling a verb is not told to call one, then or later',
          rc == 0 and out == '' and out2 == '', f'out={out2[:120]}')

    r = subprocess.run([sys.executable, HOOK], input='not json at all',
                       capture_output=True, text=True, timeout=20, env={**os.environ, 'TMPDIR': TMP})
    check('malformed input costs the agent nothing: silent, exit 0',
          r.returncode == 0 and r.stdout.strip() == '', f'rc={r.returncode}')

    r = subprocess.run([sys.executable, HOOK], input='', capture_output=True, text=True, timeout=20, env={**os.environ, 'TMPDIR': TMP})
    check('empty input costs the agent nothing either', r.returncode == 0, f'rc={r.returncode}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': 'doWork'}, session='s6')
    check('it never blocks — additionalContext only, never a permissionDecision',
          rc == 0 and ctx(out) and 'permissionDecision' not in out, out[:160])

    open(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite'), 'w').close()      # a graph file with no tables
    rc, out, _ = fire(repo, 'Grep', {'pattern': 'doWork'}, session='s7')
    check('a graph it cannot read costs the agent nothing: silent, exit 0', rc == 0 and out == '', f'out={out[:120]}')

    ro = tempfile.mkdtemp()
    graph(ro, ROWS)
    os.chmod(os.path.join(ro, '.axiomcode'), 0o500)          # nothing can be written inside the repository
    try:
        rc, out, _ = fire(ro, 'Grep', {'pattern': 'doWork'}, session='s8')
        rc2, out2, _ = fire(ro, 'Grep', {'pattern': 'Worker'}, session='s8')
        check('a repository it cannot write to gets its directive once, not before every search',
              rc == 0 and ctx(out) and rc2 == 0 and out2 == '', f'first={out[:80]} second={out2[:80]}')
    finally:
        os.chmod(os.path.join(ro, '.axiomcode'), 0o700)

    # a host that sends no session id: once per directory it runs in, not once for every such session ever
    rc, out, _ = fire(ro, 'Grep', {'pattern': 'doWork'}, session=None)
    rc2, out2, _ = fire(ro, 'Grep', {'pattern': 'Worker'}, session=None)
    rc3, out3, _ = fire(other, 'Grep', {'pattern': 'Router', 'path': other}, session=None)
    check('with no session id it is said once where the agent runs, and again in another directory',
          ctx(out) and out2 == '' and ctx(out3) and 'lib/router.js:2' in ctx(out3), f'{out[:60]} | {out2[:60]} | {out3[:60]}')

print()
print(f"{len(checked) - len(fails)} of {len(checked)} promise(s) held" if not fails else f"{len(fails)} FAILED: " + '; '.join(fails))
sys.exit(1 if fails else 0)
