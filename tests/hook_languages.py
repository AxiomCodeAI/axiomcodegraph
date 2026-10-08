#!/usr/bin/env python3
"""tests/hook_languages.py: the edit hooks speak for every language the index reads, from one table.

Each hook kept its own list of source extensions, and the edit hooks' lists had no `.cs`: a C# edit got no graph line
while a C# Read and Grep did. The lists now come from one table (_where.BY_EXT), so this checks the hooks on a C#
project, where the old lists were silent:

  · a body edit to a C# method gets the one line of reaching tests and the command that runs them (enrich.py);
  · a signature edit to a C# method gets its blast radius BEFORE it lands (changes.py, PreToolUse);
  · a test declared in an abstract C# base runs as the class that extends it, so the command filters on that class,
    not on the base, which `dotnet test --filter FullyQualifiedName~<base>` would never match;
  · control: an edit to a file no graph is built from (the .csproj) says nothing;
  · control: the one table still carries every extension the old lists had.

It indexes a small project, so it needs the engine, as run.py does.

    python3 tests/hook_languages.py
"""
import json, os, subprocess, sys, tempfile

# hook state lives in the temp directory, keyed on the session
os.environ['TMPDIR'] = tempfile.mkdtemp(prefix='ax-hooks-')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks')
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')

SRC = {
    'src/App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n</Project>\n',
    'src/App/Repo.cs': ('namespace App;\n\npublic class Repo\n{\n    public int Save(int x)\n    {\n        return x + 1;\n    }\n\n'
                        '    public int Load(int x)\n    {\n        return x - 1;\n    }\n}\n'),
    'src/App/Service.cs': ('namespace App;\n\npublic class Service\n{\n    public int Run(Repo r)\n    {\n        return r.Load(2);\n    }\n}\n'),
    'src/App.Tests/App.Tests.csproj': ('<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n'
                                       '  <ItemGroup>\n    <PackageReference Include="xunit" Version="2.9.2" />\n'
                                       '    <ProjectReference Include="../App/App.csproj" />\n  </ItemGroup>\n</Project>\n'),
    'src/App.Tests/RepoContractTests.cs': ('using App;\nusing Xunit;\n\nnamespace App.Tests;\n\npublic abstract class RepoContractTests\n{\n'
                                           '    protected abstract Repo Make();\n\n    [Fact]\n    public void SavesOne()\n    {\n'
                                           '        Make().Save(1);\n    }\n}\n'),
    'src/App.Tests/SqlRepoTests.cs': ('using App;\n\nnamespace App.Tests;\n\npublic class SqlRepoTests : RepoContractTests\n{\n'
                                      '    protected override Repo Make() => new Repo();\n}\n'),
}

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


def fire(repo, session, tool, inp, hook, event):
    ev = {'hook_event_name': event, 'tool_name': tool, 'tool_input': inp, 'cwd': repo, 'session_id': session}
    r = subprocess.run([sys.executable, os.path.join(HOOKS, hook)], input=json.dumps(ev), capture_output=True, text=True, timeout=120)
    out = r.stdout.strip()
    if not out:
        return ''
    try:
        return json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        return out


def git(repo, *a):
    subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', *a], cwd=repo, capture_output=True, check=True)


with tempfile.TemporaryDirectory() as repo:
    for n, t in SRC.items():
        os.makedirs(os.path.dirname(os.path.join(repo, n)), exist_ok=True)
        open(os.path.join(repo, n), 'w').write(t)
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init')
    built = subprocess.run(['bash', AX, 'index', repo, '--lang', 'csharp'], capture_output=True, text=True, timeout=1800)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        print('FAIL could not index the project; the engine is needed\n     ' + built.stderr.strip()[-300:])
        sys.exit(1)

    f = os.path.join(repo, 'src/App/Repo.cs')
    orig = open(f).read()

    # PreToolUse: the edit is applied to a copy, and a signature change is reported before it lands
    out = fire(repo, 'c1', 'Edit', {'file_path': f, 'old_string': 'public int Load(int x)', 'new_string': 'public int Load(long x)'},
               'changes.py', 'PreToolUse')
    check('a signature edit to a C# method gets its blast radius before it lands',
          'about to change' in out and 'Repo.Load' in out and 'Service.Run' in out, out)

    # PostToolUse: a body-only edit gets one line, the tests and the command
    open(f, 'w').write(orig.replace('x + 1', 'x + 2'))
    out = fire(repo, 'c2', 'Edit', {'file_path': f}, 'enrich.py', 'PostToolUse')
    check('a body edit to a C# method gets the line of tests that reach it', 'body edit of Repo.Save' in out, out)
    check('the command runs the class that extends the abstract base that declares the test',
          'FullyQualifiedName~SqlRepoTests' in out, out)
    check('and never the abstract base, which no inherited test is named after', 'FullyQualifiedName~RepoContractTests' not in out, out)
    open(f, 'w').write(orig)

    # control: a file no graph is built from
    p = os.path.join(repo, 'src/App/App.csproj')
    t = open(p).read()
    open(p, 'w').write(t.replace('net8.0', 'net9.0'))
    out = fire(repo, 'c3', 'Edit', {'file_path': p}, 'enrich.py', 'PostToolUse')
    out2 = fire(repo, 'c3', 'Edit', {'file_path': p, 'old_string': 'net9.0', 'new_string': 'net8.0'}, 'changes.py', 'PreToolUse')
    check('control: an edit to a .csproj says nothing', out == '' and out2 == '', out + out2)
    open(p, 'w').write(t)

sys.path.insert(0, HOOKS)
import _where
check('control: the one table still carries every extension the hooks listed before',
      all(e in getattr(_where, 'SOURCE_EXT', ()) for e in ('.java', '.ts', '.tsx', '.py', '.js', '.jsx', '.mjs', '.cjs', '.cs')), getattr(_where, 'SOURCE_EXT', None))
check('a C# test project and a *Tests.cs file are test code; a C# source file is not',
      getattr(_where, 'is_test', lambda r: None)('src/App.Tests/Anything.cs') and getattr(_where, 'is_test', lambda r: None)('src/Foo/RepoTests.cs') and not getattr(_where, 'is_test', lambda r: None)('src/App/Repo.cs'))

print()
print(f"{len(checked) - len(fails)} of {len(checked)} check(s) held" if not fails else f"{len(fails)} FAILED: " + '; '.join(fails))
sys.exit(1 if fails else 0)
