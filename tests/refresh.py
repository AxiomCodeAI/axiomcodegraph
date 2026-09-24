#!/usr/bin/env python3
"""tests/refresh.py — the graph refreshes itself after an edit, in every language (#1305).

Each language gets a throwaway git repository with a real graph. Then, per language:

  up to date     `index` with nothing changed does not rebuild
  query          an edit adds a function; a query verb, which starts the refresher and waits for it, finds it
  baseline       `changed` answers the same before and after the refresh absorbed the edit: the refresh moves the
                 graph, not the baseline edits are measured against. The answer must name the edit (a pass on two
                 empty answers is no pass), and the graph must really have moved in between
  signature      a second edit, a parameter added to the callee, is reported as a signature change, again both ways
  restored       the files put back as committed: a clean `git status` is NOT taken for fresh, the graph is rebuilt,
                 and the added function is gone from it
  single flight  a burst of triggers produces one rebuild, and queries issued while it runs all answer
  hooks          the refresh hook, fed an edit event, starts the refresher and prints nothing

    python3 tests/refresh.py [--lang java|typescript|python|javascript|csharp] [-v]
"""
import json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
FRESH = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'ax_fresh.py')
HOOK = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks', 'refresh.py')

# per language: the files, the file the edits go into, the added function, and the signature edit
LANGS = {
    'typescript': dict(
        remove='\nexport function caller(): number {\n  return helper()\n}\n',
        files={'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n',
               'src/util.ts': 'export function helper(): number {\n  return 1\n}\n\nexport function caller(): number {\n  return helper()\n}\n'},
        edit='src/util.ts', add='\nexport function added(): number {\n  return helper()\n}\n',
        sig=('export function helper(): number {', 'export function helper(n?: number): number {')),
    'javascript': dict(
        remove='\nfunction caller() {\n  return helper()\n}\n',
        files={'package.json': '{ "name": "t", "version": "1.0.0" }\n',
               'src/util.js': 'function helper() {\n  return 1\n}\n\nfunction caller() {\n  return helper()\n}\n\nmodule.exports = { helper, caller }\n'},
        edit='src/util.js', add='\nfunction added() {\n  return helper()\n}\n',
        sig=('function helper() {', 'function helper(n) {')),
    'python': dict(
        remove='\n\ndef caller():\n    return helper()\n',
        files={'pkg/__init__.py': '', 'pkg/util.py': 'def helper():\n    return 1\n\n\ndef caller():\n    return helper()\n'},
        edit='pkg/util.py', add='\n\ndef added():\n    return helper()\n',
        sig=('def helper():', 'def helper(n=0):')),
    'java': dict(
        remove='\n    public static int caller() {\n        return helper(0);\n    }\n',
        files={'src/main/java/pkg/Util.java': 'package pkg;\n\npublic class Util {\n    public static int helper() {\n        return 1;\n    }\n\n    public static int caller() {\n        return helper();\n    }\n}\n'},
        edit='src/main/java/pkg/Util.java', add=('\n}\n', '\n\n    public static int added() {\n        return helper();\n    }\n}\n'),
        sig=('public static int helper() {', 'public static int helper(int n) {'), sig_call=('return helper();', 'return helper(0);')),
    'csharp': dict(
        remove='\n        public static int Caller()\n        {\n            return Helper();\n        }\n',
        files={'App.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n',
               'Util.cs': 'namespace App\n{\n    public static class Util\n    {\n        public static int Helper()\n        {\n            return 1;\n        }\n\n        public static int Caller()\n        {\n            return Helper();\n        }\n    }\n}\n'},
        edit='Util.cs', add=('\n    }\n}\n', '\n\n        public static int Added()\n        {\n            return Helper();\n        }\n    }\n}\n'),
        sig=('public static int Helper()', 'public static int Helper(int n = 0)'), names=('Helper', 'Added')),
}


def sh(cwd, *cmd, env=None, stdin=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env, input=stdin)


def ask_changed(repo, env):
    j = json.loads(sh(repo, AX, 'changed', '.', '--json', env=env).stdout or '{}')
    return dict(changed=j.get('changed', []), notes=j.get('notes', []))


def main(argv):
    only = argv[argv.index('--lang') + 1] if '--lang' in argv else None
    verbose = '-v' in argv
    fails = []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok or not detail else '\n     ' + detail.strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = tempfile.mkdtemp(prefix='axiomcode-refresh-')
    try:
        for lang, L in LANGS.items():
            if only and lang != only: continue
            print(f"… {lang}")
            helper, added = L.get('names', ('helper', 'added'))
            repo = os.path.join(work, lang)
            for rel, text in L['files'].items():
                os.makedirs(os.path.dirname(os.path.join(repo, rel)), exist_ok=True)
                open(os.path.join(repo, rel), 'w').write(text)
            for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'),
                        ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
                sh(repo, *cmd)
            env = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_REFRESH_DEBOUNCE='0.5', AXIOMCODE_FRESH_WAIT='600')
            quiet = dict(env, AXIOMCODE_NO_REFRESH='1')          # the control: a query that neither refreshes nor waits
            out = os.path.join(repo, '.axiomcode', 'out')
            tree = lambda: open(os.path.join(out, 'indexed-tree')).read().strip() if os.path.exists(os.path.join(out, 'indexed-tree')) else ''
            rebuilds = lambda: open(os.path.join(repo, '.axiomcode', 'refresh.log')).read().count('rebuilding') if os.path.exists(os.path.join(repo, '.axiomcode', 'refresh.log')) else 0

            b = sh(repo, AX, 'index', '.', '--lang', lang, env=env)
            check(b.returncode == 0 and os.path.exists(os.path.join(out, 'files.json')), f'{lang}: the graph builds and records the files it read', b.stdout + b.stderr)
            if b.returncode: continue
            t0 = time.time(); again = sh(repo, AX, 'index', '.', '--lang', lang, env=env); took = time.time() - t0
            check('graph up to date' in again.stdout, f'{lang}: `index` with nothing changed does not rebuild ({took:.1f}s)', again.stdout + again.stderr)

            # ── an added function ─────────────────────────────────────────────────────────────────────────────
            f = os.path.join(repo, L['edit']); text = open(f).read()
            if isinstance(L['add'], tuple): text = text[:text.rindex(L['add'][0])] + L['add'][1]
            else: text += L['add']
            open(f, 'w').write(text)
            before_tree = tree()
            X = ask_changed(repo, quiet)
            p = sh(repo, AX, 'path', added, helper, '.', env=env)
            check(p.returncode == 0 and 'verified' in p.stdout and 'graph refresh:' not in p.stderr,
                  f'{lang}: after an edit, a query finds the added function and its call (the refresher ran, the query waited)', p.stdout + p.stderr)
            check(tree() and tree() != before_tree, f'{lang}: the graph was rebuilt from the edited tree')
            Y = ask_changed(repo, quiet)
            # an appended top-level function is reported by name in some languages and as "N new line(s) at file:line"
            # in others (a gap of `changed` itself, not of the refresh); either way the answer must mention the edit
            kinds = lambda R: sorted((r['kind'], r['symbol'].split('.')[-1]) for r in R['changed']) + sorted(R['notes'])
            mentions = lambda R: any(k == 'added' and s == added for k, s in kinds(R)[:len(R['changed'])]) or any('new line' in n and L['edit'] in n for n in R['notes'])
            check(mentions(X), f'{lang}: changed reports the added function before the refresh', json.dumps(X))
            check(kinds(X) == kinds(Y), f'{lang}: changed answers the same after the refresh as before it', f'before {kinds(X)}\nafter  {kinds(Y)}')

            # ── a signature edit on top ───────────────────────────────────────────────────────────────────────
            text = open(f).read().replace(*L['sig'])
            if L.get('sig_call'): text = text.replace(*L['sig_call'])
            open(f, 'w').write(text)
            X2 = ask_changed(repo, quiet)
            sh(repo, AX, 'impact', helper, '.', env=env)
            Y2 = ask_changed(repo, quiet)
            # JavaScript also records a function declaration as a variable, and `changed` reports the edit as that
            # variable's (a gap of `changed`, the same with or without a refresh); the kind is not what is tested here
            check(any(s == helper and k in ('signature', 'field') for k, s in kinds(X2)[:len(X2['changed'])]) and mentions(X2),
                  f'{lang}: a parameter added to the callee is reported, and the added function still is', json.dumps(X2))
            check(kinds(X2) == kinds(Y2), f'{lang}: the same after the second refresh', f'before {kinds(X2)}\nafter  {kinds(Y2)}')

            # ── a removal: the baseline graph still has what was removed, and who called it ────────────────────
            text = open(f).read(); assert L['remove'] in text, L['remove']
            open(f, 'w').write(text.replace(L['remove'], '\n', 1))
            caller = 'caller' if lang != 'csharp' else 'Caller'
            X3 = ask_changed(repo, quiet); T3 = sh(repo, AX, 'test-impact', '.', '--json', env=quiet).stdout
            sh(repo, AX, 'path', added, helper, '.', env=env)             # a current-state query: refreshes and waits
            Y3 = ask_changed(repo, quiet); U3 = sh(repo, AX, 'test-impact', '.', '--json', env=quiet).stdout
            tchanged = lambda T: sorted(r['symbol'] for r in (json.loads(T or '{}').get('changed') or []))
            check(tchanged(T3) and T3 == U3, f'{lang}: test-impact answers the same before and after the refresh', f'before {tchanged(T3)}\nafter  {tchanged(U3)}')
            # how `changed` classifies it (removed, or a signature when the diff pairs it with a neighbour) is its own
            # business; that it is reported, and the same way on both sides of the refresh, is the claim here
            check(any(s == caller for _, s in kinds(X3)[:len(X3['changed'])]) and kinds(X3) == kinds(Y3), f'{lang}: a removed function is reported the same before and after the refresh', f'before {kinds(X3)}\nafter  {kinds(Y3)}')
            ci = sh(repo, AX, 'changed', '.', '--impact', env=quiet).stdout
            check(os.path.isdir(os.path.join(repo, '.axiomcode', 'base')) and caller in ci and 'unavailable' not in ci,
                  f'{lang}: after the refresh, `changed --impact` still answers for the removed function from the baseline graph', ci[-800:])
            nowq = sh(repo, AX, 'path', caller, helper, '.', env=quiet)
            check('verified' not in nowq.stdout, f'{lang}: while the current graph no longer has it', nowq.stdout[-400:])

            # ── single flight, and queries during the rebuild ─────────────────────────────────────────────────
            open(f, 'a').write('\n')
            n0 = rebuilds()
            # graph.sqlite must exist at every instant of a refresh: a verb that finds none builds one, a second full
            # build racing the first. Probed every millisecond, since the gap it closes was one rename wide
            import threading
            probe = dict(missing=0, looks=0, stop=False)
            def watch():
                g = os.path.join(out, 'graph.sqlite')
                while not probe['stop']:
                    probe['looks'] += 1; probe['missing'] += not os.path.exists(g); time.sleep(0.001)
            th = threading.Thread(target=watch); th.start()
            for _ in range(5): sh(repo, sys.executable, FRESH, 'kick', '.', env=env)
            asked, answered, during, deadline = 0, 0, 0, time.time() + 600
            while time.time() < deadline:
                st = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=env).stdout or '{}').get('state')
                q = sh(repo, AX, 'path', added, helper, '.', env=quiet)
                asked += 1; answered += q.returncode == 0 and 'verified' in q.stdout
                during += st == 'building'
                if st == 'fresh' and rebuilds() > n0: break
                time.sleep(0.1)
            probe['stop'] = True; th.join()
            check(rebuilds() - n0 == 1, f'{lang}: five triggers in a burst cost one rebuild ({rebuilds() - n0})')
            check(probe['looks'] > 100 and probe['missing'] == 0, f"{lang}: graph.sqlite existed at every one of {probe['looks']} looks during the rebuild ({probe['missing']} missing)")
            check(asked == answered and during > 0, f'{lang}: every query issued while it ran answered ({answered} of {asked}, {during} while the build held its lock)')

            # ── the files restored: git calls the tree clean, the graph still holds the edits ────────────────────
            sh(repo, 'git', 'checkout', '-q', '--', '.')
            st = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
            check(st.get('state') == 'stale' and L['edit'] in st.get('changed', []), f'{lang}: a tree restored to the commit is stale against a graph built from the edit', json.dumps(st))
            again = sh(repo, AX, 'index', '.', '--lang', lang, env=quiet)
            # `index` rebuilds it, or waits for a refresh already rebuilding it (the refresher saw the checkout first)
            deadline = time.time() + 600                          # a refresher queued behind `index` on the build lock
            while True:                                            # takes it next, finds the graph current, and exits
                now = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
                if now.get('state') != 'building' or time.time() > deadline: break
                time.sleep(0.2)
            check(again.returncode == 0 and now.get('state') == 'fresh', f'{lang}: and after `index` the graph matches the restored files', again.stdout + again.stderr + json.dumps(now))
            gone = sh(repo, AX, 'path', added, helper, '.', env=quiet)
            check('verified' not in gone.stdout, f'{lang}: the added function is gone from the rebuilt graph', gone.stdout)

            # ── the hook ──────────────────────────────────────────────────────────────────────────────────────
            open(f, 'a').write('\n')
            n0 = rebuilds()
            ev = json.dumps({'hook_event_name': 'PostToolUse', 'tool_name': 'Edit', 'cwd': repo, 'session_id': 't',
                             'tool_input': {'file_path': f}})
            t0 = time.time(); h = sh(repo, sys.executable, HOOK, env=env, stdin=ev); took = time.time() - t0
            check(h.returncode == 0 and not h.stdout.strip(), f'{lang}: the refresh hook returns at once ({took:.2f}s) and prints nothing', h.stdout + h.stderr)
            deadline = time.time() + 600
            while time.time() < deadline and not (rebuilds() > n0 and json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=env).stdout or '{}').get('state') == 'fresh'):
                time.sleep(0.2)
            check(rebuilds() > n0, f'{lang}: the refresher it started rebuilt the graph')

            # ── a graph from before the file table ────────────────────────────────────────────────────────────
            for x in ('files.json', 'base-tree', 'base-commit'):
                if os.path.exists(os.path.join(out, x)): os.remove(os.path.join(out, x))
            old_tree = tree()
            open(f, 'a').write('\n')
            n0 = rebuilds()
            sh(repo, AX, 'path', added, helper, '.', env=env)
            deadline = time.time() + 600
            while time.time() < deadline and not (os.path.exists(os.path.join(out, 'files.json')) and not json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=env).stdout or '{}').get('state') == 'building'):
                time.sleep(0.2)
            st = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
            check(rebuilds() > n0 and st.get('state') == 'fresh', f'{lang}: a graph built before the file table refreshes with its own parameters and records one', json.dumps(st))
            base = open(os.path.join(out, 'base-tree')).read().strip() if os.path.exists(os.path.join(out, 'base-tree')) else ''
            check(base == old_tree, f"{lang}: and its baseline stays the tree it was indexed from", f'base {base} old indexed {old_tree}')
            if verbose: print(open(os.path.join(repo, '.axiomcode', 'refresh.log')).read())
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'ok' if not fails else f'{len(fails)} FAILED'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
