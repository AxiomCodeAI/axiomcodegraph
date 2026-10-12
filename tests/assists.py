#!/usr/bin/env python3
"""tests/assists.py — the Stop hook's receipt (#1935) credits an answer only for what the session shows it led to.

Each check writes a small transcript in the host's shape (prompts, tool calls, their results) into a scratch git
repository, and asks the rules what they find. A rule is checked from both sides: the case it must credit, and a near
case that differs only where the rule reads and must not be credited. No engine and no model are needed.

    python3 tests/assists.py
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks')
sys.path.insert(0, os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts'))
import ax_assists as A

fails = []
def check(why, cond, detail=''):
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


MCP = 'mcp__plugin_axiomcode_axiomcode__impact'
IMPACT_A = '1. src/pkg/alpha.py:10  [resolved · Alpha.run]\n   ```python\n   → 10  self.beta()\n   ```\nverified: ✓'
TESTS_A = '1. tests/test_alpha.py:5  [test]\nrun them: pytest tests/test_alpha.py'


class T:
    """a transcript under construction"""
    def __init__(self, root):
        self.root, self.lines, self.n = root, [], 0

    def prompt(self, text):
        self.lines.append({'type': 'user', 'message': {'role': 'user', 'content': text}})
        return self

    def call(self, name, inp, result='', error=False, side=False):
        self.n += 1
        tid = f'toolu_{self.n:03d}'
        self.lines.append({'type': 'assistant', 'isSidechain': side,
                           'message': {'role': 'assistant', 'content': [{'type': 'tool_use', 'id': tid, 'name': name, 'input': inp}]}})
        self.lines.append({'type': 'user', 'isSidechain': side,
                           'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': tid,
                                                                    'content': result, 'is_error': error}]}})
        return self

    def read(self, rel):
        return self.call('Read', {'file_path': os.path.join(self.root, rel)}, 'contents')

    def edit(self, rel):
        return self.call('Edit', {'file_path': os.path.join(self.root, rel), 'old_string': 'a', 'new_string': 'b'}, 'ok')

    def save(self):
        p = os.path.join(self.root, '..', f'transcript-{id(self)}.jsonl')
        with open(p, 'w') as f:
            for l in self.lines:
                f.write(json.dumps(l) + '\n')
        return p


def repo():
    d = os.path.realpath(tempfile.mkdtemp(prefix='ax-assists-'))
    r = os.path.join(d, 'repo')
    os.makedirs(os.path.join(r, 'src', 'pkg')); os.makedirs(os.path.join(r, 'tests'))
    for f in ('src/pkg/alpha.py', 'src/pkg/beta.py', 'src/pkg/gamma.py', 'tests/test_alpha.py'):
        open(os.path.join(r, f), 'w').write('x = 1\n')
    for c in (['init', '-q'], ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base']):
        subprocess.run(['git', '-C', r] + c, check=True)
    return r


def change(r, rel):
    open(os.path.join(r, rel), 'a').write('y = 2\n')


def found(t, r, diff=True):
    return A.chains(A.steps(t.save()), r, A.working_diff(r) if diff else None)


# --- Helped: first seen in the answer, then read and edited, and the edit kept
r = repo(); change(r, 'src/pkg/alpha.py')
t = T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_A).read('src/pkg/alpha.py').edit('src/pkg/alpha.py')
c = found(t, r)
check('an answer that showed a file the agent then edited is Helped', [x['label'] for x in c] == ['Helped'], c)
check('the chain carries the tool calls it stands on', c and c[0]['evidence']['edit'] and c[0]['evidence']['answer'] == 'toolu_001', c)

# --- an MCP answer wrapped as {"result": …}, the file at the start of a line
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, json.dumps({'result': 'further away:\nsrc/pkg/alpha.py:10  run  [hop 2]'}))
     .edit('src/pkg/alpha.py'))
check('an MCP answer wrapped in {"result": …} is read with its line breaks', [x['label'] for x in found(t, r)] == ['Helped'], found(t, r))

# --- the same, but the prompt already named the file: not first seen, no credit
r = repo(); change(r, 'src/pkg/alpha.py')
t = T(r).prompt('fix the bug in src/pkg/alpha.py').call(MCP, {'name': 'Alpha.run'}, IMPACT_A).edit('src/pkg/alpha.py')
check('a file the prompt named is not credited to the answer', found(t, r) == [], found(t, r))

# --- an earlier tool result named it (a grep hit): no credit
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call('Grep', {'pattern': 'run'}, 'src/pkg/alpha.py:10: def run')
     .call(MCP, {'name': 'Alpha.run'}, IMPACT_A).edit('src/pkg/alpha.py'))
check('a file an earlier grep showed is not credited', found(t, r) == [], found(t, r))

# --- the edit was reverted: what is left is a read, so Useful
r = repo()
t = T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_A).read('src/pkg/alpha.py').edit('src/pkg/alpha.py')
check('an edit no longer in the working tree is not Helped (Useful: it was read)', [x['label'] for x in found(t, r)] == ['Useful'], found(t, r))

# --- an answer nobody acted on prints nothing
r = repo()
t = T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_A)
check('an answer nothing came from is not a chain', found(t, r) == [], found(t, r))

# --- Redirected: two files dropped, the change lands in the one the answer showed
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').read('src/pkg/beta.py').read('src/pkg/gamma.py')
     .call(MCP, {'name': 'Alpha.run'}, IMPACT_A).read('src/pkg/alpha.py').edit('src/pkg/alpha.py'))
c = found(t, r)
check('dropped files plus a change landing in the answer\'s file is Redirected',
      [x['label'] for x in c] == ['Redirected'] and c[0]['from'] == ['src/pkg/beta.py', 'src/pkg/gamma.py'], c)

# --- control: one of those files is touched again after the answer, and one file alone was looked at once
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').read('src/pkg/beta.py').read('src/pkg/gamma.py')
     .call(MCP, {'name': 'Alpha.run'}, IMPACT_A).edit('src/pkg/alpha.py').read('src/pkg/gamma.py'))
c = found(t, r)
check('a file gone back to after the answer was not left behind (one dropped read is not a redirect)',
      [x['label'] for x in c] == ['Helped'], c)

# --- control: the earlier file is in the final diff, so the work did not move away from it
r = repo(); change(r, 'src/pkg/alpha.py'); change(r, 'src/pkg/beta.py')
t = (T(r).prompt('fix the bug in run').read('src/pkg/beta.py').read('src/pkg/beta.py')
     .call(MCP, {'name': 'Alpha.run'}, IMPACT_A).edit('src/pkg/alpha.py'))
check('a file still in the diff was not left behind', [x['label'] for x in found(t, r)] == ['Helped'], found(t, r))

# --- picked tests: ran and passed is Helped; ran and failed is Useful
r = repo()
t = (T(r).prompt('which tests cover my change').call('mcp__plugin_axiomcode_axiomcode__tests', {}, TESTS_A)
     .call('Bash', {'command': 'pytest tests/test_alpha.py -q'}, '1 passed'))
c = found(t, r)
check('picked tests that ran and passed are Helped', [x['label'] for x in c] == ['Helped'] and c[0]['tests_passed'] == 1, c)
r = repo()
t = (T(r).prompt('which tests cover my change').call('mcp__plugin_axiomcode_axiomcode__tests', {}, TESTS_A)
     .call('Bash', {'command': 'pytest tests/test_alpha.py -q'}, 'Exit code 1\n1 failed', error=True))
check('picked tests that failed are only Useful', [x['label'] for x in found(t, r)] == ['Useful'], found(t, r))

# --- a test file the agent already knew of is not picked by an impact answer; a tests answer picks what it names
r = repo()
IMPACT_T = IMPACT_A + '\ntests:\n   tests/test_alpha.py:5  test_run  [test]'
t = (T(r).prompt('fix the bug in run').read('tests/test_alpha.py').call(MCP, {'name': 'Alpha.run'}, IMPACT_T)
     .call('Bash', {'command': 'pytest tests/test_alpha.py -q'}, '1 passed'))
check('an impact answer is not credited for running a test file the agent had already opened', found(t, r, diff=False) == [],
      found(t, r, diff=False))
r = repo()
t = (T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_T)
     .call('Bash', {'command': 'pytest tests/test_alpha.py -q'}, '1 passed'))
check('…but is when the answer showed it first', [x['label'] for x in found(t, r, diff=False)] == ['Useful'], found(t, r, diff=False))

# --- one shell line that writes a file and runs the tests, failing, still wrote the file
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_A)
     .call('Bash', {'command': "python3 - <<'EOF'\np='src/pkg/alpha.py'\ns=open(p).read()\nopen(p,'w').write(s)\nEOF\npytest -q"},
           'Exit code 1', error=True))
check('a write in a shell line that then fails its tests is still an edit', [x['label'] for x in found(t, r)] == ['Helped'], found(t, r))
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_A)
     .call('Bash', {'command': "cat >> notes.jsonl <<'EOF'\n{\"file\": \"src/pkg/alpha.py\"}\nEOF"}, ''))
check('a shell line that only mentions a file (a log it appends to) did not edit it', found(t, r) == [], found(t, r))

# --- one test run is credited once, to the first answer that picked it
r = repo()
t = (T(r).prompt('which tests cover my change').call('mcp__plugin_axiomcode_axiomcode__tests', {}, TESTS_A)
     .call('Bash', {'command': 'axiomcode tests --json /tmp/out.json'}, TESTS_A)
     .call('Bash', {'command': 'pytest tests/test_alpha.py -q'}, '1 passed'))
c = found(t, r)
check('a test run two answers picked is credited once', len(c) == 1, c)
check('a flag or an output path is not shown as what was asked', A._q(dict(verb='tests', arg='--json /tmp/out.json')) == '`tests`',
      A._q(dict(verb='tests', arg='--json /tmp/out.json')))

# --- the CLI through a shell counts as an answer; a shell line that also lists files does not
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call('Bash', {'command': 'axiomcode impact Alpha.run 2>&1 | head -40'}, IMPACT_A)
     .edit('src/pkg/alpha.py'))
c = found(t, r)
check('`axiomcode impact` in a shell is an answer, its argument without the redirection',
      [x['label'] for x in c] == ['Helped'] and c[0]['arg'] == 'Alpha.run', c)
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call('Bash', {'command': 'axiomcode impact Alpha.run; ls src/pkg'},
                                            'no callers found\nsrc/pkg/alpha.py\nsrc/pkg/beta.py')
     .edit('src/pkg/alpha.py'))
check('a shell line that also lists files credits nothing from the listing', found(t, r) == [], found(t, r))
r = repo(); change(r, 'src/pkg/gamma.py')
t = (T(r).prompt('fix the bug in run').call('Bash', {'command': 'axiomcode impact Alpha.run; grep -rn run src'},
                                            'src/pkg/gamma.py:3:run()\n' + IMPACT_A).edit('src/pkg/gamma.py'))
check('in a shell line that also greps, a file only grep printed is not credited', found(t, r) == [], found(t, r))
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call('Bash', {'command': 'axiomcode impact Alpha.run; grep -rn zzz src'},
                                            'no match\n' + IMPACT_A).edit('src/pkg/alpha.py'))
check('…but a row of the answer in that line is', [x['label'] for x in found(t, r)] == ['Helped'], found(t, r))

# --- a bare file name (a listing, prose) is not a place the answer gave
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, 'Alpha.run is defined in alpha.py')
     .edit('src/pkg/alpha.py'))
check('a bare file name in an answer is not credited', found(t, r) == [], found(t, r))

# --- what a subagent saw is not the session's
r = repo(); change(r, 'src/pkg/alpha.py')
t = (T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_A, side=True).edit('src/pkg/alpha.py'))
check('an answer inside a subagent is not credited to the session', found(t, r) == [], found(t, r))

# --- the ledger: printed once; printed again only when it grows
r = repo(); change(r, 'src/pkg/alpha.py')
t = T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_A).read('src/pkg/alpha.py')
p = t.save()
subprocess.run(['git', '-C', r, 'checkout', '-q', '--', '.'])
first = A.at_stop(p, r, 's1')
again = A.at_stop(p, r, 's1')
change(r, 'src/pkg/alpha.py'); t.edit('src/pkg/alpha.py'); p = t.save()
grown = A.at_stop(p, r, 's1')
check('a chain prints once (Useful)', 'Useful' in first and again == '', (first, again))
check('it prints again when it grows a stronger label', 'Helped' in grown, grown)
check('the ledger keeps both', len(A._load(r)) == 2, A._load(r))
out, n = A.report(r)
page = open(out).read()
check('the report renders the session\'s chains', n == 1 and 'Helped' in page and '<code>impact Alpha.run</code>' in page, (out, n))

# --- the hook end to end: a Stop event in, a message for the user out; switched off, nothing
r = repo(); change(r, 'src/pkg/alpha.py')
t = T(r).prompt('fix the bug in run').call(MCP, {'name': 'Alpha.run'}, IMPACT_A).edit('src/pkg/alpha.py')
ev = {'hook_event_name': 'Stop', 'session_id': 's2', 'transcript_path': t.save(), 'cwd': r, 'stop_hook_active': False}
h = subprocess.run([sys.executable, os.path.join(HOOKS, 'assist.py')], input=json.dumps(ev), capture_output=True, text=True)
msg = json.loads(h.stdout).get('systemMessage', '') if h.stdout.strip() else ''
check('the Stop hook prints the receipt as a message for the user', h.returncode == 0 and msg.startswith('◆ AxiomCode') and 'Helped' in msg,
      (h.returncode, h.stdout, h.stderr))
ev['session_id'] = 's3'
h = subprocess.run([sys.executable, os.path.join(HOOKS, 'assist.py')], input=json.dumps(ev), capture_output=True, text=True,
                   env=dict(os.environ, AXIOMCODE_ASSISTS='off'))
check('AXIOMCODE_ASSISTS=off prints nothing', h.returncode == 0 and not h.stdout.strip(), h.stdout)
h = subprocess.run([sys.executable, os.path.join(HOOKS, 'assist.py')], input='{"hook_event_name":"Stop"}', capture_output=True, text=True)
check('a Stop event with no transcript is silent and never fails', h.returncode == 0 and not h.stdout.strip(), (h.returncode, h.stdout))

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
