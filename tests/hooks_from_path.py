#!/usr/bin/env python3
"""tests/hooks_from_path.py: every hook finds the graph from the path the tool touched, not from the session's directory.

Agents work from a directory with no graph and reach indexed trees by absolute path. The hooks looked for the graph
in the session's working directory only, so they almost never spoke. The layout here is that shape:

    ws/                    the session's working directory, no graph
    ws/app/                an indexed project
    ws/plain/              the same sources, never indexed
    ws/link  -> ws/app     a symlink to the indexed project
    ws/app/vendored -> ws/plain   a symlink inside the indexed project to a tree with no graph

Promises, each with a near-miss control:
  · a Read, a Grep with path=, a shell `sed -n` by absolute path and a `cd <app> && grep` from ws/ are enriched, the
    Read exactly as it is from inside ws/app;
  · the state and budget files are kept in the repository's .axiomcode, not the working directory's;
  · the directive stays silent on a shell `cat` of a file that is not source, as it is on a Read of one;
  · controls: a path with no graph anywhere above it, a path ABOVE the indexed root, and a symlink out of the indexed
    tree all stay silent; a symlink INTO it answers from the real graph;
  · the prompt hook tells a C#-only tree with no graph that one can be built (#1453), and a workspace above an indexed
    tree is not told it has no graph;
  · finding the graph costs well under the hooks' budget: < 20 ms per lookup, cached per directory for the session.

    python3 tests/hooks_from_path.py
"""
import json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks')
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
P = 'src/main/java/app/orders/'
SRC = {
    'pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>app</groupId><artifactId>app</artifactId><version>1</version></project>\n',
    P + 'OrderStore.java': 'package app.orders;\n\npublic class OrderStore {\n    public String findById(int id) {\n        return "order-" + id;\n    }\n}\n',
    P + 'OrderService.java': ('package app.orders;\n\npublic class OrderService {\n    private final OrderStore store = new OrderStore();\n\n'
                              '    public String show(int id) { return store.findById(id); }\n\n'
                              '    public String cancel(int id) { return store.findById(id); }\n}\n'),
    'notes.md': '# notes\nfindById is the lookup\n',
}

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {str(detail)[:400]}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


def fire(cwd, session, tool, inp, hook='enrich.py', event='PostToolUse', **extra):
    ev = dict({'hook_event_name': event, 'tool_name': tool, 'tool_input': inp, 'cwd': cwd, 'session_id': session}, **extra)
    r = subprocess.run([sys.executable, os.path.join(HOOKS, hook)], input=json.dumps(ev), capture_output=True, text=True, timeout=120)
    out = r.stdout.strip()
    if not out:
        return ''
    try:
        return json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        return out


def write(base, files):
    for n, t in files.items():
        os.makedirs(os.path.dirname(os.path.join(base, n)) or base, exist_ok=True)
        open(os.path.join(base, n), 'w').write(t)


with tempfile.TemporaryDirectory() as tmp:
    ws = os.path.realpath(tmp)
    app, plain = os.path.join(ws, 'app'), os.path.join(ws, 'plain')
    write(app, SRC); write(plain, SRC)
    subprocess.run(['git', 'init', '-q'], cwd=app, capture_output=True)
    subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'x', '--allow-empty'], cwd=app, capture_output=True)
    subprocess.run(['git', 'add', '-A'], cwd=app, capture_output=True)
    subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], cwd=app, capture_output=True)
    built = subprocess.run(['bash', AX, 'index', app, '--lang', 'java'], capture_output=True, text=True, timeout=1800)
    if not os.path.exists(os.path.join(app, '.axiomcode', 'out', 'graph.sqlite')):
        print('FAIL could not index the project; the engine is needed\n     ' + built.stderr.strip()[-300:])
        sys.exit(1)
    os.symlink(app, os.path.join(ws, 'link'))
    os.symlink(plain, os.path.join(app, 'vendored'))
    store, svc = os.path.join(app, P, 'OrderStore.java'), os.path.join(app, P, 'OrderService.java')

    # ── Read / Grep / shell from a directory with no graph ────────────────────────────────────────────────
    inside = fire(app, 'in', 'Read', {'file_path': store})
    check('control: a Read from inside the indexed project is enriched', 'findById' in inside and 'graph:' in inside, inside)
    outside = fire(ws, 'ws1', 'Read', {'file_path': store})
    check('a Read by absolute path from a directory with no graph gets the same block as from inside', outside == inside, outside)
    g = fire(ws, 'ws2', 'Grep', {'pattern': 'findById', 'path': app})
    check('a Grep with path= the indexed project gets the caller preview', 'OrderStore.findById' in g and '← 2' in g, g)
    s = fire(ws, 'ws3', 'Bash', {'command': f'sed -n 1,40p {store}'})
    check('a shell `sed -n` of a file by absolute path is enriched', 'findById' in s, s)
    c = fire(ws, 'ws4', 'Bash', {'command': f'cd {app} && grep -rn findById src'})
    check('a `cd <project> && grep` is enriched', 'OrderStore.findById' in c, c)
    rel = fire(ws, 'ws5', 'Read', {'file_path': os.path.relpath(store, ws)})
    check('a relative file_path is resolved against the session directory', rel == inside, rel)

    # ── state is per repository ───────────────────────────────────────────────────────────────────────────
    check('the session state is kept in the repository it is about',
          os.path.exists(os.path.join(app, '.axiomcode', 'hooks-state-ws1.json')), os.listdir(os.path.join(app, '.axiomcode')))
    check('and nothing is written in the working directory', not os.path.exists(os.path.join(ws, '.axiomcode')))
    again = fire(ws, 'ws1', 'Read', {'file_path': os.path.join(ws, 'link', P, 'OrderStore.java')})
    check('the per-session dedup holds across two spellings of one file (it is one repository\'s state)', again == '', again)

    # ── controls: silent where no graph is above the path ────────────────────────────────────────────────
    check('control: a Read of a file with no graph anywhere above it stays silent',
          fire(ws, 'c1', 'Read', {'file_path': os.path.join(plain, P, 'OrderStore.java')}) == '')
    check('control: the same file through the SESSION directory of an indexed project stays silent',
          fire(app, 'c2', 'Read', {'file_path': os.path.join(plain, P, 'OrderStore.java')}) == '')
    check('control: a Grep of a path above the indexed root stays silent', fire(ws, 'c3', 'Grep', {'pattern': 'findById', 'path': ws}) == '')
    check('control: a Grep with no path from a directory with no graph stays silent', fire(ws, 'c4', 'Grep', {'pattern': 'findById'}) == '')
    check('control: a shell grep of a tree with no graph stays silent', fire(ws, 'c5', 'Bash', {'command': f'grep -rn findById {plain}/src'}) == '')
    ln = fire(ws, 'c6', 'Read', {'file_path': os.path.join(ws, 'link', P, 'OrderStore.java')})
    check('a symlink INTO the indexed project answers from its real graph', ln == inside, ln)
    check('control: a symlink OUT of the indexed project to a tree with no graph stays silent',
          fire(app, 'c7', 'Read', {'file_path': os.path.join(app, 'vendored', P, 'OrderStore.java')}) == '')

    # ── the directive (PreToolUse) ────────────────────────────────────────────────────────────────────────
    d = fire(ws, 'd1', 'Read', {'file_path': svc}, hook='direct.py', event='PreToolUse')
    check('the directive speaks before a Read by absolute path from a directory with no graph', 'axiomcode_impact' in d, d)
    check('control: the directive is silent before a Read in a tree with no graph',
          fire(ws, 'd2', 'Read', {'file_path': os.path.join(plain, P, 'OrderStore.java')}, hook='direct.py', event='PreToolUse') == '')
    check('the directive is silent on a shell `cat` of a file that is not source',
          fire(app, 'd3', 'Bash', {'command': 'cat notes.md'}, hook='direct.py', event='PreToolUse') == '')
    d = fire(app, 'd4', 'Bash', {'command': f'cat {os.path.relpath(store, app)}'}, hook='direct.py', event='PreToolUse')
    check('control: the directive speaks on a shell `cat` of a source file', 'axiomcode_impact' in d, d)

    # ── orientation ──────────────────────────────────────────────────────────────────────────────────────
    for i in range(30):
        write(ws, {f'more/src/Extra{i}.java': f'class Extra{i} {{}}\n'})
    o = fire(ws, 'o1', 'Read', {}, hook='orient.py', event='UserPromptSubmit', prompt='what breaks if I change the findById method in this workspace')
    check('a workspace above an indexed project is not told it has no graph', 'no call graph yet' not in o, o)
    shutil.rmtree(os.path.join(ws, 'more'))
    cs = os.path.join(ws, 'cs')
    write(cs, {'App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n'})
    for i in range(1, 31):
        write(cs, {f'Widget{i}.cs': f'namespace App;  public class Widget{i} {{ }}\n'})
    o = fire(cs, 'o2', 'Read', {}, hook='orient.py', event='UserPromptSubmit', prompt='what breaks if I change the Widget1 class in this repo')
    check('a C#-only tree with no graph is told one can be built (#1453)', 'no call graph yet' in o, o)
    for i in range(6, 31):
        os.remove(os.path.join(cs, f'Widget{i}.cs'))
    o = fire(cs, 'o3', 'Read', {}, hook='orient.py', event='UserPromptSubmit', prompt='what breaks if I change the Widget1 class in this repo')
    check('control: a C# tree of five files is too small to be told', o == '', o)

    # ── cost ─────────────────────────────────────────────────────────────────────────────────────────────
    sys.path.insert(0, HOOKS); import _where
    _where.session('perf'); t = time.perf_counter()
    r1 = _where.root_of(store); cold = time.perf_counter() - t
    t = time.perf_counter()
    for _ in range(50): _where.root_of(svc)
    warm = (time.perf_counter() - t) / 50
    check(f'finding the graph costs < 20 ms (cold {cold * 1000:.2f} ms, cached {warm * 1000:.2f} ms)', r1 == app and cold < 0.02 and warm < 0.02, (r1, cold, warm))
    lang = os.path.join(ws, 'poly'); os.makedirs(os.path.join(lang, '.axiomcode', 'lang', 'python', 'out')); os.makedirs(os.path.join(lang, 'pkg'))
    open(os.path.join(lang, '.axiomcode', 'lang', 'python', 'out', 'graph.sqlite'), 'w').close()
    check('a repository whose only graph is a per-language one is found', _where.root_of(os.path.join(lang, 'pkg')) == lang)
    check('and a file of that language is answered from it',
          _where.graph_db(lang, 'pkg/a.py') == os.path.join(lang, '.axiomcode', 'lang', 'python', 'out', 'graph.sqlite'))

print(f"\n{len(checked) - len(fails)}/{len(checked)} passed")
sys.exit(1 if fails or not checked else 0)
