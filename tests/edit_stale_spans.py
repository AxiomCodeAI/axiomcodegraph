#!/usr/bin/env python3
"""tests/edit_stale_spans.py: the edit hook judges an edit against the file as it is, not at the graph's old line numbers.

The graph's spans are line numbers in the text it was indexed from. Between an edit and the background refresh the file
is ahead of the graph, and the PreToolUse hook (changes.py, through `axiomcode changed --old/--new`) read the edited
text at the graph's numbers: a deleted line that sat where the graph had a field was reported as that field removed,
and a field line that sat where the graph had a method header as that method's signature change. It also asserted
"removed" for a method only moved below its neighbour, read an edited import as "signature <module>", and answered the
removal of one `helper` with the callers of every other `helper` in the project.

For Python, Java and C#, on a small project indexed once, with an earlier edit the graph has not seen yet:

  · a line deleted where the graph had a field: no field reported removed;
      control: deleting the field's own line still reports it removed;
  · a field initializer edited where the graph had a method header: the field, not the method's signature;
      control: a real parameter added to that method is still a signature change;
  · a method moved below its neighbour: not removed;
  · removing a function whose name another file also declares: only this file's callers;
  · (Python) an edited import line: never a signature of the module;
  · the graph's rows and the tree it records for them disagree (a refresh raced an edit): declarations are placed by
    name and the answer says so; control: a faithful recorded tree says nothing of the kind;
  · after a rebase the baseline has not followed yet, the commit that came in is not reported as this session's edit;
      control: an edit left uncommitted after the rebase still is.

It indexes three small projects, so it needs the engine, as run.py does.

    python3 tests/edit_stale_spans.py
"""
import json, os, subprocess, sys, tempfile

os.environ['TMPDIR'] = tempfile.mkdtemp(prefix='ax-stale-')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks')
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond: fails.append(why)

def git(repo, *a):
    subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', *a], cwd=repo, capture_output=True, check=True)

n = [0]
def fire_bash(repo, cmd):
    """run a shell command in the repository, then the PostToolUse Bash hook on it, with the refresher off so the
    baseline stays where it was (the state a rebase leaves for as long as the rebuild takes)"""
    ran = subprocess.run(cmd, shell=True, cwd=repo, capture_output=True, text=True)
    if ran.returncode: print(f'     (command failed: {ran.stderr.strip()[-300:]})')
    n[0] += 1
    ev = {'hook_event_name': 'PostToolUse', 'tool_name': 'Bash', 'cwd': repo, 'session_id': f's{n[0]}', 'tool_input': {'command': cmd}}
    r = subprocess.run([sys.executable, os.path.join(HOOKS, 'changes.py')], input=json.dumps(ev), capture_output=True, text=True,
                       timeout=180, env=dict(os.environ, AXIOMCODE_NO_REFRESH='1'))
    out = r.stdout.strip()
    try: out = json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError): pass
    return out

def changed_json(repo, rel, new_text):
    tf = tempfile.NamedTemporaryFile('w', suffix=os.path.splitext(rel)[1], delete=False); tf.write(new_text); tf.close()
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode-changed'), repo,
                        '--old', os.path.join(repo, rel), '--new', tf.name, '--file', rel, '--json'], capture_output=True, text=True, timeout=120)
    os.unlink(tf.name)
    try: return json.loads(r.stdout)
    except ValueError: return {'changed': [], 'notes': [r.stderr[-300:]]}

def fire(repo, rel, old, new, pre=()):
    """the file as committed, then `pre` (edits the graph has not seen), then the hook on the Edit old -> new"""
    git(repo, 'checkout', '-q', '--', '.')
    f = os.path.join(repo, rel); t = open(f).read()
    for o, nn in pre:
        assert o in t, o
        t = t.replace(o, nn, 1)
    open(f, 'w').write(t)
    assert old in t, old
    n[0] += 1
    ev = {'hook_event_name': 'PreToolUse', 'tool_name': 'Edit', 'cwd': repo, 'session_id': f's{n[0]}',
          'tool_input': {'file_path': f, 'old_string': old, 'new_string': new}}
    r = subprocess.run([sys.executable, os.path.join(HOOKS, 'changes.py')], input=json.dumps(ev), capture_output=True, text=True, timeout=180)
    out = r.stdout.strip()
    try: out = json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError): pass
    return out

PY = {
    'pkg/__init__.py': '', 'pkg/a/__init__.py': '', 'pkg/b/__init__.py': '',
    'pkg/a/utils.py': ('"""Utilities for a."""\nimport os\n\n\ndef helper(x):\n    """Return x plus one."""\n    return x + 1\n\n\n'
                       'class Stale:\n    """Tracks stale files."""\n\n    def __init__(self, root):\n        self.root = root\n        self.files = []\n\n'
                       '    def mark_text(self, path, text):\n        """Mark one file."""\n        self.files.append((path, text))\n        return len(self.files)\n\n'
                       '    def count(self):\n        return len(self.files)\n'),
    'pkg/b/utils.py': 'def helper(y):\n    return y * 2\n',
    'pkg/a/use.py': 'from pkg.a.utils import helper, Stale\n\n\ndef run():\n    s = Stale("/")\n    s.mark_text("p", "t")\n    return helper(1) + s.count()\n',
    'pkg/b/go.py': 'from pkg.b.utils import helper\n\n\ndef go():\n    return helper(3)\n',
}
JAVA = {
    'src/main/java/a/Util.java': 'package a;\n\npublic class Util {\n    /** Return x plus one. */\n    public static int helper(int x) {\n        return x + 1;\n    }\n}\n',
    'src/main/java/b/Util.java': 'package b;\n\npublic class Util {\n    public static int helper(int y) {\n        return y * 2;\n    }\n}\n',
    'src/main/java/a/Stale.java': ('package a;\n\nimport java.util.ArrayList;\nimport java.util.List;\n\npublic class Stale {\n    private final String root;\n'
                                   '    private List<String> files = new ArrayList<>();\n\n    public Stale(String root) {\n        this.root = root;\n    }\n\n'
                                   '    /** Mark one file. */\n    public int markText(String path, String text) {\n        files.add(path);\n        return files.size();\n    }\n\n'
                                   '    public int count() {\n        return files.size();\n    }\n}\n'),
    'src/main/java/a/Use.java': 'package a;\n\npublic class Use {\n    public int run() {\n        Stale s = new Stale("/");\n        s.markText("p", "t");\n        return Util.helper(1) + s.count();\n    }\n}\n',
    'src/main/java/b/Go.java': 'package b;\n\npublic class Go {\n    public int go() {\n        return Util.helper(3);\n    }\n}\n',
}
CS = {
    'src/App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n</Project>\n',
    'src/App/UtilA.cs': 'namespace A\n{\n    public static class Util\n    {\n        public static int Helper(int x)\n        {\n            return x + 1;\n        }\n    }\n}\n',
    'src/App/UtilB.cs': 'namespace B\n{\n    public static class Util\n    {\n        public static int Helper(int y)\n        {\n            return y * 2;\n        }\n    }\n}\n',
    'src/App/Stale.cs': ('using System.Collections.Generic;\n\nnamespace A\n{\n    public class Stale\n    {\n        private readonly string root;\n'
                         '        private List<string> files = new List<string>();\n\n        public Stale(string root)\n        {\n            this.root = root;\n        }\n\n'
                         '        /// <summary>Mark one file.</summary>\n        public int MarkText(string path, string text)\n        {\n            files.Add(path);\n            return files.Count;\n        }\n\n'
                         '        public int Count()\n        {\n            return files.Count;\n        }\n    }\n}\n'),
    'src/App/Use.cs': 'namespace A\n{\n    public class Use\n    {\n        public int Run()\n        {\n            var s = new Stale("/");\n            s.MarkText("p", "t");\n            return Util.Helper(1) + s.Count();\n        }\n    }\n}\n',
    'src/App/Go.cs': 'namespace B\n{\n    public class Go\n    {\n        public int Go2()\n        {\n            return Util.Helper(3);\n        }\n    }\n}\n',
}

def project(lang, files):
    repo = tempfile.mkdtemp(prefix=f'ax-stale-{lang}-')
    for p, t in files.items():
        os.makedirs(os.path.dirname(os.path.join(repo, p)), exist_ok=True)
        open(os.path.join(repo, p), 'w').write(t)
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init')
    built = subprocess.run(['bash', AX, 'index', repo, '--lang', lang], capture_output=True, text=True, timeout=1800)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        print(f'FAIL could not index the {lang} project; the engine is needed\n     ' + built.stderr.strip()[-300:]); sys.exit(1)
    return repo

# per language: the Stale file, the lines each case needs, the Util file, the other file's caller, this file's caller
CASES = {
    'python': dict(files=PY, other_util='pkg/b/utils.py', other_sig='def helper(y):', other_sig_new='def helper(y, z=0):',
                   stale='pkg/a/utils.py', util='pkg/a/utils.py', other='go', mine='run', field='files',
                   after_root='        self.root = root\n', added='        self.seen = 0\n', top='import os\n',
                   field_line='        self.files = []\n', field_edit='        self.files = list()\n', method='mark_text',
                   sig='    def mark_text(self, path, text):', sig_new='    def mark_text(self, path, text, force=False):',
                   helper='def helper(x):\n    """Return x plus one."""\n    return x + 1\n',
                   moved=('    def mark_text(self, path, text):\n        """Mark one file."""\n        self.files.append((path, text))\n        return len(self.files)\n\n',
                          '    def count(self):\n        return len(self.files)\n')),
    'java': dict(files=JAVA, other_util='src/main/java/b/Util.java', other_sig='public static int helper(int y)', other_sig_new='public static int helper(int y, int z)',
                   stale='src/main/java/a/Stale.java', util='src/main/java/a/Util.java', other='Go.go', mine='Use.run', field='files',
                 after_root='    private final String root;\n', added='    private int seen = 0;\n', top='import java.util.List;\n',
                 field_line='    private List<String> files = new ArrayList<>();\n', field_edit='    private List<String> files = new ArrayList<>(8);\n', method='markText',
                 sig='public int markText(String path, String text)', sig_new='public int markText(String path, String text, boolean force)',
                 helper='    /** Return x plus one. */\n    public static int helper(int x) {\n        return x + 1;\n    }\n',
                 moved=('    /** Mark one file. */\n    public int markText(String path, String text) {\n        files.add(path);\n        return files.size();\n    }\n\n',
                        '    public int count() {\n        return files.size();\n    }\n')),
    'csharp': dict(files=CS, other_util='src/App/UtilB.cs', other_sig='public static int Helper(int y)', other_sig_new='public static int Helper(int y, int z)',
                   stale='src/App/Stale.cs', util='src/App/UtilA.cs', other='Go.Go2', mine='Use.Run', field='files',
                   after_root='        private readonly string root;\n', added='        private int seen = 0;\n', top='using System.Collections.Generic;\n',
                   field_line='        private List<string> files = new List<string>();\n', field_edit='        private List<string> files = new List<string>(8);\n', method='MarkText',
                   sig='public int MarkText(string path, string text)', sig_new='public int MarkText(string path, string text, bool force)',
                   helper='        public static int Helper(int x)\n        {\n            return x + 1;\n        }\n',
                   moved=('        /// <summary>Mark one file.</summary>\n        public int MarkText(string path, string text)\n        {\n            files.Add(path);\n            return files.Count;\n        }\n\n',
                          '        public int Count()\n        {\n            return files.Count;\n        }\n')),
}

only = sys.argv[1:] or list(CASES)
for lang in only:
    c = CASES[lang]; repo = project(lang, c['files'])
    # enough lines above the field that its line now sits where the graph has the method's header
    pad = [(c['top'], c['top'] + ''.join(f"{'#' if lang == 'python' else '//'} pad {k}\n" for k in range({'python': 2, 'java': 7, 'csharp': 8}[lang])))]

    out = fire(repo, c['stale'], c['added'], '', pre=[(c['after_root'], c['after_root'] + c['added'])])
    check(f'{lang}: deleting a line added since the index, where the graph has a field, removes no field', 'removed' not in out, out)
    out = fire(repo, c['stale'], c['field_line'], '')
    check(f'{lang}: control: deleting the field\'s own line reports it removed', f"removed Stale.{c['field']}" in out, out)

    out = fire(repo, c['stale'], c['field_line'], c['field_edit'], pre=pad)
    check(f'{lang}: a field edited where the graph had a method header is the field, not the method', f"field Stale.{c['field']}" in out and 'signature' not in out, out)
    out = fire(repo, c['stale'], c['sig'], c['sig_new'], pre=pad)
    check(f'{lang}: control: a parameter added to that method is still its signature change', f"signature Stale.{c['method']}" in out and '+force' in out, out)

    a, b = c['moved']
    out = fire(repo, c['stale'], a + b, b + '\n' + a.rstrip('\n') + '\n')
    check(f'{lang}: a method moved below its neighbour is not removed', 'removed' not in out, out)

    out = fire(repo, c['util'], c['helper'], '')
    check(f'{lang}: removing a function lists this file\'s caller', c['mine'] in out and 'removed' in out, out)
    check(f'{lang}: ... and not the caller of the same-named function in another file', c['other'] not in out, out)

    if lang == 'python':
        out = fire(repo, c['stale'], 'import os\n', 'import os, http\n')
        check('python: an edited import line is never a signature of the module', 'signature' not in out, out)
    git(repo, 'checkout', '-q', '--', '.')

    # the rows are the committed text's, and the tree the graph says it was built from is a later one
    it = os.path.join(repo, '.axiomcode', 'out', 'indexed-tree'); faithful = open(it).read()
    f = os.path.join(repo, c['stale']); t0 = open(f).read(); shifted = t0.replace(pad[0][0], pad[0][1], 1)
    open(f, 'w').write(shifted); git(repo, 'commit', '-qam', 'shift')
    open(it, 'w').write(subprocess.run(['git', 'rev-parse', 'HEAD^{tree}'], cwd=repo, capture_output=True, text=True).stdout.strip() + '\n')
    j = changed_json(repo, c['stale'], shifted.replace(c['field_line'], c['field_edit'], 1))
    kinds = [f"{e['kind']} {e['symbol']}" for e in j.get('changed', [])]
    check(f'{lang}: rows and recorded tree disagree: the field edit is still the field, not a signature',
          f"field Stale.{c['field']}" in kinds and not any(k.startswith('signature') for k in kinds), kinds)
    check(f'{lang}: ... and the answer says the declarations were placed by name', any('disagree' in x for x in j.get('notes', [])), j.get('notes'))
    git(repo, 'reset', '-q', '--hard', 'HEAD~1'); open(it, 'w').write(faithful)
    open(f, 'w').write(shifted)
    j = changed_json(repo, c['stale'], shifted.replace(c['field_line'], c['field_edit'], 1))
    check(f'{lang}: control: a faithful recorded tree is not called a disagreement', not any('disagree' in x for x in j.get('notes', [])) and
          f"field Stale.{c['field']}" in [f"{e['kind']} {e['symbol']}" for e in j.get('changed', [])], j)
    git(repo, 'checkout', '-q', '--', '.')

    # a rebase onto a commit that changed another file's function: HEAD moved, the baseline did not
    base = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=repo, capture_output=True, text=True).stdout.strip()
    git(repo, 'checkout', '-q', '-b', 'feature')
    u = os.path.join(repo, c['util']); ut = open(u).read(); open(u, 'w').write(ut.replace('return x + 1', 'return x + 2', 1)); git(repo, 'commit', '-qam', 'mine')
    mine = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, capture_output=True, text=True).stdout.strip()
    git(repo, 'checkout', '-q', base)
    o = os.path.join(repo, c['other_util']); ot = open(o).read(); open(o, 'w').write(ot.replace(c['other_sig'], c['other_sig_new'], 1)); git(repo, 'commit', '-qam', 'upstream')
    git(repo, 'checkout', '-q', 'feature')
    out = fire_bash(repo, f'git rebase {base}')
    check(f'{lang}: after a rebase, the commit that came in is not reported as an edit', 'signature' not in out and '+z' not in out, out)
    git(repo, 'reset', '-q', '--hard', mine)
    out = fire_bash(repo, f"git rebase {base} && {sys.executable} -c \"import sys; p=sys.argv[1]; t=open(p).read(); open(p,'w').write(t.replace(sys.argv[2], sys.argv[3], 1))\" {c['stale']} '{c['sig']}' '{c['sig_new']}'")
    check(f'{lang}: control: an edit left uncommitted after the rebase is reported', f"signature Stale.{c['method']}" in out, out or subprocess.run(['git', 'status', '--short'], cwd=repo, capture_output=True, text=True).stdout)

print(f"\n{len(checked) - len(fails)}/{len(checked)} passed")
if not checked: sys.exit(1)
sys.exit(1 if fails else 0)
