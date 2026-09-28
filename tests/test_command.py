#!/usr/bin/env python3
"""tests/test_command.py — the command test-impact prints for a TypeScript or JavaScript selection runs those files.

`npx vitest run <file>` on a file vitest does not collect exits 1 with "No test files found" (#1570). Each file is
placed with the runner its own package would collect it with (that runner's include globs), else with the command
its package scripts, its own header or its package README give for it, else named as collected by nothing. Every
shape here has a control beside it: a file the runner does collect keeps the runner's command. No engine needed.
"""
import importlib.machinery, importlib.util, json, os, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
sys.path.insert(0, SCRIPTS)
loader = importlib.machinery.SourceFileLoader('ti', os.path.join(SCRIPTS, 'axiomcode-test-impact'))
ti = importlib.util.module_from_spec(importlib.util.spec_from_loader('ti', loader)); loader.exec_module(ti)
import ax_pages

fails = 0


def check(why, got, want):
    global fails
    if got != want:
        fails += 1; print(f"FAIL {why}\n     got:  {got!r}\n     want: {want!r}")
    else:
        print(f"ok   {why}")


def tree(files):
    d = tempfile.mkdtemp(prefix='ax-cmd-')
    for rel, text in files.items():
        p = os.path.join(d, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w').write(text if isinstance(text, str) else json.dumps(text))
    return d


VITEST_PKG = {'scripts': {'test': 'vitest'}, 'devDependencies': {'vitest': '1'}}

# the defaults the runners document, read as globs
for g, path, want in [('**/*.{test,spec}.?(c|m)[jt]s?(x)', 'src/a.test.ts', True),
                      ('**/*.{test,spec}.?(c|m)[jt]s?(x)', 'a.spec.mjs', True),
                      ('**/*.{test,spec}.?(c|m)[jt]s?(x)', 'src/test/a-tests.ts', False),
                      ('**/?(*.)+(spec|test).[jt]s?(x)', 'src/a.test.tsx', True),
                      ('**/?(*.)+(spec|test).[jt]s?(x)', 'src/test.ts', True),
                      ('**/?(*.)+(spec|test).[jt]s?(x)', 'src/tests.ts', False),
                      ('**/__tests__/**/*.[jt]s?(x)', 'src/__tests__/a.ts', True),
                      ('test/*.{js,cjs,mjs}', 'test/a.js', True),
                      ('test/*.{js,cjs,mjs}', 'test/sub/a.js', False)]:
    check(f"glob {g} {'matches' if want else 'does not match'} {path}", ti._globs_match((g,), path), want)

# #1570: a script suite in a vitest package is run as its header says, from its package
d = tree({'parser/package.json': VITEST_PKG,
          'parser/src/test/a-tests.ts': '/**\n *     npx tsx src/test/a-tests.ts   # everything\n */\n',
          'parser/src/test/b-tests.ts': 'import x from "y";\n',
          'parser/README.md': '```\nnpx tsx src/test/b-tests.ts\n```\n',
          'parser/src/test/c-tests.ts': 'export {};\n',
          'parser/src/cart.test.ts': ''})
cmds, unrun = ti.js_plan(d, ['parser/src/test/a-tests.ts', 'parser/src/test/b-tests.ts',
                             'parser/src/test/c-tests.ts', 'parser/src/cart.test.ts'])
check("a vitest-collected file keeps vitest, run from its package (control)",
      cmds[0], '(cd parser && npx vitest run src/cart.test.ts)')
check("a script suite gets its header's command", cmds[1], '(cd parser && npx tsx src/test/a-tests.ts)')
check("a script suite with no header gets its package README's command", cmds[2],
      '(cd parser && npx tsx src/test/b-tests.ts)')
check("a file nothing runs is named, not handed to vitest", unrun, ['parser/src/test/c-tests.ts'])
check("no command names a file vitest does not collect", [c for c in cmds if 'vitest' in c and 'tests.ts' in c], [])
shutil.rmtree(d)

# a package script that names the file
d = tree({'package.json': {'scripts': {'test:e2e': 'tsx e2e/run-e2e.ts'}, 'devDependencies': {'vitest': '1'}},
          'e2e/run-e2e.ts': ''})
check("a package script naming the file is the command", ti.js_plan(d, ['e2e/run-e2e.ts']), (['npm run test:e2e'], []))
shutil.rmtree(d)

# vitest with its own include: a file outside it is not vitest's, a file inside it is (control)
d = tree({'package.json': VITEST_PKG,
          'vitest.config.ts': "export default { test: { include: ['tests/**/*.ts'] } }\n",
          'tests/unit/a.ts': '', 'src/b.test.ts': ''})
check("a configured vitest include collects what it names",
      ti.js_plan(d, ['tests/unit/a.ts']), (['npx vitest run tests/unit/a.ts'], []))
check("a configured vitest include leaves out a default-named file outside it",
      ti.js_plan(d, ['src/b.test.ts']), ([], ['src/b.test.ts']))
shutil.rmtree(d)

# jest: its own runner, its own defaults
d = tree({'package.json': {'devDependencies': {'jest': '29'}}, 'src/__tests__/a.ts': '', 'src/b.spec.js': ''})
check("jest collects __tests__ and *.spec with its own command",
      ti.js_plan(d, ['src/__tests__/a.ts', 'src/b.spec.js']), (['npx jest src/__tests__/a.ts src/b.spec.js'], []))
shutil.rmtree(d)

# mocha: test/*.js by default
d = tree({'package.json': {'devDependencies': {'mocha': '10'}}, 'test/a.js': ''})
check("mocha collects test/*.js with its own command", ti.js_plan(d, ['test/a.js']), (['npx mocha test/a.js'], []))
shutil.rmtree(d)

# a workspace member with no runner of its own is run by the root's
d = tree({'package.json': {'workspaces': ['pkgs/*'], 'devDependencies': {'vitest': '1'}},
          'pkgs/core/package.json': {'name': 'core'}, 'pkgs/core/src/a.test.ts': ''})
check("a workspace member without a runner is run by the root's, with the root path",
      ti.js_plan(d, ['pkgs/core/src/a.test.ts']), (['npx vitest run pkgs/core/src/a.test.ts'], []))
shutil.rmtree(d)

# control: nothing configured anywhere, a *.test.ts file still gets the command it always got
d = tree({'src/a.test.ts': ''})
check("nothing configured: a *.test.ts file keeps `npx vitest run` (control)",
      ti.command_for('typescript', ['src/a.test.ts'], [], d), 'npx vitest run src/a.test.ts')
shutil.rmtree(d)

# control: other languages are untouched
check("python unchanged (control)", ti.command_for('python', ['tests/test_a.py'], []), 'pytest tests/test_a.py')
check("java unchanged (control)", ti.command_for('java', [], ['app.ATest']), 'mvn test -Dtest=ATest')

# the next: line names every command, and still names a single one as it did
check("next: one command is named as before (control)",
      ax_pages.next_test_impact("\n  npx vitest run src/a.test.ts\n").split(' — ')[0], 'next: run npx vitest run src/a.test.ts')
check("next: a (cd pkg && …) command is recognised",
      ax_pages.next_test_impact("\n  (cd parser && npx tsx src/test/a-tests.ts)\n").split(' — ')[0],
      'next: run (cd parser && npx tsx src/test/a-tests.ts)')
check("next: several commands are counted",
      ax_pages.next_test_impact("\n  (cd p && npx tsx a.ts)\n  (cd p && npx tsx b.ts)\n").startswith('next: run the 2 commands above'),
      True)

print('\n' + ('all passed' if not fails else f"{fails} FAILED"))
sys.exit(1 if fails else 0)
