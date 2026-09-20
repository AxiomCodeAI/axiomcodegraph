#!/usr/bin/env python3
"""tests/directive.py — the PreToolUse directive hook, checked on the promises it makes.

This hook runs before EVERY Read, Grep, Glob and Bash in any repository that has a graph. That reach is
the reason it is worth having and the reason it is worth pinning: a hook that raises, blocks, or speaks
when it has nothing to say costs every agent using the plugin something, on every turn.

Each check names the promise rather than the code path, so a failure here says which promise broke.
"""
import json, os, subprocess, sys, tempfile

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    '..', 'plugins', 'axiomcode', 'hooks', 'direct.py')


def fire(repo, tool, inp):
    ev = json.dumps({'tool_name': tool, 'tool_input': inp, 'cwd': repo})
    r = subprocess.run([sys.executable, HOOK], input=ev, capture_output=True, text=True, timeout=20)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def ctx(out):
    if not out:
        return None
    return json.loads(out)['hookSpecificOutput']['additionalContext']


fails = []
def check(why, cond, detail=''):
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


with tempfile.TemporaryDirectory() as repo:
    os.makedirs(os.path.join(repo, 'src'))
    open(os.path.join(repo, 'src', 'A.java'), 'w').write('class A { void f(){} }\n')

    rc, out, err = fire(repo, 'Grep', {'pattern': 'f'})
    check('a repository with no graph hears nothing, because the verbs could not answer anyway',
          rc == 0 and out == '', f'rc={rc} out={out[:120]}')

    os.makedirs(os.path.join(repo, '.axiomcode', 'out'))
    open(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite'), 'w').close()

    rc, out, _ = fire(repo, 'Grep', {'pattern': 'f'})
    first = ctx(out)
    check('the first search in a session is told what the graph answers that a search cannot',
          rc == 0 and first and 'impact' in first and 'never spell the name' in first, f'rc={rc}')

    rc, out, _ = fire(repo, 'Read', {'file_path': 'src/A.java'})
    second = ctx(out)
    check('every later search is reminded, in one line rather than the paragraph',
          rc == 0 and second and second != first and len(second.splitlines()) == 1, f'got {second!r}')

    rc, out, _ = fire(repo, 'Read', {'file_path': 'README.md'})
    check('reading something that is not source is not the decision this is about',
          rc == 0 and out == '', f'out={out[:120]}')

    rc, out, _ = fire(repo, 'Bash', {'command': 'axiomcode impact A.f'})
    check('an agent already calling a verb is not told to call one',
          rc == 0 and out == '', f'out={out[:120]}')

    r = subprocess.run([sys.executable, HOOK], input='not json at all',
                       capture_output=True, text=True, timeout=20)
    check('malformed input costs the agent nothing: silent, exit 0',
          r.returncode == 0 and r.stdout.strip() == '', f'rc={r.returncode}')

    r = subprocess.run([sys.executable, HOOK], input='', capture_output=True, text=True, timeout=20)
    check('empty input costs the agent nothing either', r.returncode == 0, f'rc={r.returncode}')

    rc, out, _ = fire(repo, 'Grep', {'pattern': 'f'})
    check('it never blocks — additionalContext only, never a permissionDecision',
          rc == 0 and 'permissionDecision' not in out, out[:160])

    ro = tempfile.mkdtemp()
    os.makedirs(os.path.join(ro, '.axiomcode', 'out'))
    open(os.path.join(ro, '.axiomcode', 'out', 'graph.sqlite'), 'w').close()
    os.chmod(os.path.join(ro, '.axiomcode'), 0o500)          # stamp cannot be written
    try:
        rc, out, _ = fire(ro, 'Grep', {'pattern': 'f'})
        check('a repository it cannot write to still gets its directive, not an error',
              rc == 0 and ctx(out), f'rc={rc} out={out[:120]}')
    finally:
        os.chmod(os.path.join(ro, '.axiomcode'), 0o700)

print()
print(f"{8 + 1 - len(fails)} of 9 promise(s) held" if not fails else f"{len(fails)} FAILED: " + '; '.join(fails))
sys.exit(1 if fails else 0)
