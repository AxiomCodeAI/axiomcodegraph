#!/usr/bin/env python3
"""tests/diff_verb.py: `axiomcode diff` compares two graphs of one tree by what stays put, never by id.

Every engine change was measured before and after by hand SQL over call_edges joined to sites and methods, because
ids hash the index directory: two graphs of one tree, built at two paths, share no id, so a join on ids says that
everything changed. The verb joins on file, line, column, qualified name and callee as written.

Per language (Python, Java, C#), one small tree indexed three times:

  here     the tree
  there    the same tree copied to another path (Java records absolute paths, so this also checks they are made
           relative before they are compared)
  added    `there` with one more call written on an existing line, so no other line moves
           (no tree has an entry point, so the new callee does not also become reachable: that would be a
           second, correct row)

  control  here vs there: no difference in any kind, while both graphs hold call edges (a diff of two empty graphs
           would pass this vacuously, so the edge count is asserted too)
  one row  there vs added: exactly one call edge added, the new callee, and no other row of any kind
  --file   the same pair scoped to a file that holds no change: nothing
  --json   the same counts as the text
  dirs     the index directories and the graph.sqlite paths answer the same

    python3 tests/diff_verb.py [-v] [--lang python,java,csharp]
"""
import json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')

TREES = {
    'python': ({
        'shop/__init__.py': '',
        'shop/orders.py': 'def helper_one():\n    return 1\n\n\ndef helper_two():\n    return 2\n\n\n'
                          'def total():\n    a = helper_one(); return a\n',
        'shop/cli.py': 'from shop.orders import total\n\n\ndef main():\n    return total()\n',
    }, ('shop/orders.py', 'a = helper_one(); return a', 'a = helper_one(); helper_two(); return a'), 'helper_two', 'shop/cli.py'),
    'java': ({
        'src/main/java/shop/Orders.java': 'package shop;\n\npublic class Orders {\n    int helperOne() { return 1; }\n\n'
                                          '    int helperTwo() { return 2; }\n\n'
                                          '    public int total() { int a = helperOne(); return a; }\n}\n',
        'src/main/java/shop/Cli.java': 'package shop;\n\npublic class Cli {\n    public int run() {\n'
                                       '        return new Orders().total();\n    }\n}\n',
    }, ('src/main/java/shop/Orders.java', 'int a = helperOne(); return a;', 'int a = helperOne(); helperTwo(); return a;'), 'helperTwo', 'Cli.java'),
    'csharp': ({
        'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n</Project>\n',
        'App/Orders.cs': 'namespace App;\n\npublic class Orders\n{\n    int HelperOne() { return 1; }\n\n    int HelperTwo() { return 2; }\n\n'
                         '    public int Total() { int a = HelperOne(); return a; }\n}\n',
        'App/Cli.cs': 'namespace App;\n\npublic static class Cli\n{\n    public static int Run() { return new Orders().Total(); }\n}\n',
    }, ('App/Orders.cs', 'int a = HelperOne(); return a;', 'int a = HelperOne(); HelperTwo(); return a;'), 'HelperTwo', 'Cli.cs'),
}
KINDS = ('entry_points', 'reachable', 'remote', 'framework', 'config', 'symbols')


def make(root, files):
    for rel, text in files.items():
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w').write(text)


def main(argv):
    verbose = '-v' in argv
    langs = list(TREES)
    if '--lang' in argv:
        langs = argv[argv.index('--lang') + 1].split(',')
    fails = []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok and not verbose or not detail else '\n     ' + detail.strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    env = dict(os.environ, AXIOMCODE_ENGINE=os.environ.get('AXIOMCODE_ENGINE') or ROOT, AXIOMCODE_NO_REFRESH='1')
    for k in ('AXIOMCODE_LANG', 'AXIOMCODE_SRC', 'AXIOMCODE_LIBRARY', 'AXIOMCODE_GRAPH'): env.pop(k, None)

    def ax(*a):
        return subprocess.run(['bash', AX, *a], capture_output=True, text=True, env=env)

    work = os.path.realpath(tempfile.mkdtemp(prefix='axiomcode-diffverb-'))
    try:
        for lang in langs:
            files, (edit_file, old, new), callee, other = TREES[lang]
            here, there, added = (os.path.join(work, lang, n) for n in ('here', 'there', 'added'))
            make(here, files); make(there, files)
            make(added, dict(files, **{edit_file: files[edit_file].replace(old, new)}))
            assert files[edit_file].count(old) == 1
            built = True
            for d in (here, there, added):
                r = ax('index', d, '--lang', lang)
                if not os.path.isfile(os.path.join(d, '.axiomcode', 'out', 'graph.sqlite')):
                    check(False, f'{lang}: index {os.path.basename(d)}', r.stdout + r.stderr); built = False; break
            if not built:
                continue

            # ── control: one tree at two paths ─────────────────────────────────────────────────────────────
            r = ax('diff', here, there, '--json')
            doc = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else {}
            res = doc.get('languages', {}).get(lang, {})
            n = res.get('counts', {})
            edges = sum(a for a, _b in res.get('tiers', {}).values())
            check(edges >= 1, f'{lang}: control is not vacuous (the graphs hold {edges} call edge(s))', r.stdout + r.stderr)
            check(bool(n) and not any(n['calls'].values()) and not any(any(v.values()) for k, v in n.items() if k != 'calls'),
                  f'{lang}: the same tree indexed at two paths diffs to nothing', json.dumps(n) + r.stderr)
            t = ax('diff', here, there)
            check('no difference' in t.stdout, f'{lang}: and the text says so', t.stdout + t.stderr)

            # ── one added call ─────────────────────────────────────────────────────────────────────────────
            r = ax('diff', there, added, '--json')
            doc = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else {}
            res = doc.get('languages', {}).get(lang, {})
            n = res.get('counts', {})
            rows = res.get('calls', {}).get('added', [])
            check(n.get('calls') == {'added': 1, 'removed': 0, 'retiered': 0, 'changed': 0}
                  and len(rows) == 1 and callee in rows[0]['callee'] and rows[0]['file'].endswith(edit_file),
                  f'{lang}: one call added on an existing line shows exactly one call-edge row, to {callee}', r.stdout[-1500:] + r.stderr)
            check(bool(n) and not any(any(v.values()) for k, v in n.items() if k != 'calls'),
                  f'{lang}: and no row of any other kind', json.dumps(n))
            t = ax('diff', there, added)
            plus = [l for l in t.stdout.splitlines() if re.match(r'\s+[+\-~>] ', l)]
            check(len(plus) == 1 and callee in plus[0] and 'call edges +1 -0 ~0 >0' in t.stdout,
                  f'{lang}: the text has the same one row and summary', t.stdout + t.stderr)
            # the graph.sqlite paths answer as the directories do
            g1, g2 = (os.path.join(d, '.axiomcode', 'out', 'graph.sqlite') for d in (there, added))
            t2 = ax('diff', g1, g2)
            strip = lambda s: [l for l in s.splitlines() if not re.match(r'^\S+: A |^\s+B ', l)]
            check(strip(t2.stdout) == strip(t.stdout), f'{lang}: two graph.sqlite paths answer as the two directories do', t2.stdout + t2.stderr)
            # --file: a file with no change in it scopes the diff to nothing
            t3 = ax('diff', there, added, '--file', other, '--json')
            n3 = json.loads(t3.stdout)['languages'][lang]['counts'] if t3.returncode == 0 else {}
            check(bool(n3) and not any(n3['calls'].values()), f'{lang}: --file {other} (no change there) scopes it to nothing', t3.stdout[-800:] + t3.stderr)
            t4 = ax('diff', there, added, '--file', edit_file.split('/')[-1], '--json')
            n4 = json.loads(t4.stdout)['languages'][lang]['counts'] if t4.returncode == 0 else {}
            check(n4.get('calls', {}).get('added') == 1, f'{lang}: --file {edit_file.split("/")[-1]} keeps the row', t4.stdout[-800:] + t4.stderr)

        # a directory with no graph is refused, and says how to make one
        empty = os.path.join(work, 'empty'); os.makedirs(empty)
        r = ax('diff', empty, empty)
        check(r.returncode != 0 and 'axiomcode index' in r.stderr, 'a directory with no graph is refused with the command that makes one', r.stderr)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(('\nFAIL' if fails else '\nok') + f': {len(fails)} failure(s)')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
