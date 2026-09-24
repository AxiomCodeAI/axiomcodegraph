#!/usr/bin/env python3
"""tests/hosts.py — each hook says the same thing to every host that runs it, in that host's shape.

hooks.json is read by more than one host. Cursor converts its events and runs the same scripts, but sends
its own names (beforeSubmitPrompt / preToolUse / postToolUse, Shell for Bash, workspace_roots for cwd) and
reads only its own output: one JSON object, {"additional_context": …}, plus "continue": true on
beforeSubmitPrompt. Plain text is a parse error there and hookSpecificOutput is ignored, so a hook that
answers in the original shape runs in Cursor, costs a process, and reaches no one.

Each check fires one hook twice, as the original host and as Cursor (CURSOR_VERSION set, Cursor's names),
and compares what the model would receive. It indexes one case, so it needs the engine, as run.py does.

    python3 tests/hosts.py
"""
import json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks')
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
CASE = os.path.join(ROOT, 'tests', 'cases', 'python', 'decorator-rebinds-name')
CURSOR_KEYS = {'additional_context', 'continue'}

fails = []
def check(why, cond, detail=''):
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


def fire(hook, ev, cursor=False):
    env = {k: v for k, v in os.environ.items() if k != 'CURSOR_VERSION'}
    if cursor:
        env['CURSOR_VERSION'] = '3.2.0'
    r = subprocess.run([sys.executable, os.path.join(HOOKS, hook)], input=json.dumps(ev), env=env,
                       capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout.strip()


def original(event, tool, inp, repo, session, **extra):
    return dict({'hook_event_name': event, 'tool_name': tool, 'tool_input': inp, 'cwd': repo,
                 'session_id': session}, **extra)


def cursor(event, tool, inp, repo, session, **extra):
    return dict({'hook_event_name': event, 'tool_name': tool, 'tool_input': inp, 'workspace_roots': [repo],
                 'conversation_id': session, 'cursor_version': '3.2.0'}, **extra)


def said_original(out):
    """what the model receives from a hook in the original host: hookSpecificOutput, or plain text"""
    if not out:
        return ''
    try:
        return json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        return out


def said_cursor(out, event):
    """what Cursor passes on: the output must be empty or one JSON object of Cursor's keys"""
    if not out:
        return ''
    try:
        o = json.loads(out)
    except ValueError:
        check(f'{event}: Cursor output is one JSON object', False, out[:160])
        return None
    check(f'{event}: Cursor output carries only its own keys', isinstance(o, dict) and set(o) <= CURSOR_KEYS,
          str(o)[:160])
    if event == 'beforeSubmitPrompt':
        check('beforeSubmitPrompt: the answer lets the prompt through', o.get('continue') is True, str(o)[:160])
    return o.get('additional_context', '')


with tempfile.TemporaryDirectory() as work:
    # orient.py speaks without a graph only in a codebase (25 source files) and on a prompt long enough to
    # carry a task.
    bare = os.path.join(work, 'bare')
    os.makedirs(bare)
    for i in range(25):
        open(os.path.join(bare, f'm{i}.py'), 'w').write(f'def f{i}():\n    return {i}\n')
    task = 'where is the greeting function defined and who calls it'

    # UserPromptSubmit with no graph: orient.py says how to build one, as plain text in the original host.
    rc, out = fire('orient.py', {'prompt': task, 'cwd': bare, 'session_id': 'o1'})
    rc2, out2 = fire('orient.py', {'hook_event_name': 'beforeSubmitPrompt', 'prompt': task,
                                   'workspace_roots': [bare], 'conversation_id': 'o2'}, cursor=True)
    first = said_original(out)
    check('orient: the original host hears that there is no graph yet', rc == 0 and 'no call graph' in first,
          out[:160])
    check('orient: Cursor hears the same words, wrapped as additional_context',
          rc2 == 0 and first and said_cursor(out2, 'beforeSubmitPrompt') == first, out2[:160])

    repo = os.path.join(work, 'repo')
    shutil.copytree(CASE, repo)
    built = subprocess.run(['bash', AX, 'index', repo], capture_output=True, text=True, timeout=900)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        print('FAIL could not index the case; the engine is needed\n     ' + built.stderr.strip()[-300:])
        sys.exit(1)
    lib = os.path.join(repo, 'lib.py')

    # PostToolUse Read: enrich.py adds the edges the file does not show.
    rc, out = fire('enrich.py', original('PostToolUse', 'Read', {'file_path': lib}, repo, 'e1'))
    rc2, out2 = fire('enrich.py', cursor('postToolUse', 'Read', {'file_path': lib}, repo, 'e2'), cursor=True)
    first = said_original(out)
    check('enrich after a Read: the original host hears the callers the file does not show',
          rc == 0 and 'test_greet' in first, out[:160])
    check('enrich after a Read: Cursor hears the same lines', rc2 == 0 and first and said_cursor(out2, 'postToolUse') == first,
          out2[:160])

    # PostToolUse on a shell read: Cursor calls the tool Shell. `cat` of a source file is enriched as a Read.
    grep = {'command': 'cat lib.py'}
    rc, out = fire('enrich.py', original('PostToolUse', 'Bash', grep, repo, 'g1'))
    rc2, out2 = fire('enrich.py', cursor('postToolUse', 'Shell', grep, repo, 'g2'), cursor=True)
    first = said_original(out)
    check('enrich after `cat` in a shell: the original host hears the callers', rc == 0 and 'test_greet' in first,
          out[:160])
    check("enrich after `cat` in a shell: Cursor's Shell is the same tool as Bash",
          rc2 == 0 and first and said_cursor(out2, 'postToolUse') == first, out2[:160])

    # PreToolUse: Cursor's preToolUse output has no context field, so the directive stays silent there.
    rc, out = fire('direct.py', original('PreToolUse', 'Grep', {'pattern': 'greet'}, repo, 'd1'))
    rc2, out2 = fire('direct.py', cursor('preToolUse', 'Grep', {'pattern': 'greet'}, repo, 'd2'), cursor=True)
    check('direct: the original host hears the directive', rc == 0 and 'impact' in said_original(out), out[:160])
    check('direct: Cursor hears nothing, since preToolUse cannot carry context', rc2 == 0 and out2 == '', out2[:160])

    # UserPromptSubmit with a graph: changes.py and orient.py answer in Cursor's shape or not at all.
    for hook in ('changes.py', 'orient.py'):
        rc2, out2 = fire(hook, cursor('beforeSubmitPrompt', None, {}, repo, 'p1', prompt='what calls greet'),
                         cursor=True)
        said = said_cursor(out2, 'beforeSubmitPrompt')
        check(f'{hook} on beforeSubmitPrompt: exit 0 and Cursor-shaped', rc2 == 0 and said is not None, out2[:160])

print('ok' if not fails else f'{len(fails)} failure(s)')
sys.exit(1 if fails else 0)
