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

# a runner's collection is read the way the runner reads it. Each shape: (files, the file, expected plan)
V = {'devDependencies': {'vitest': '1'}}
J = {'scripts': {'test': 'jest'}, 'devDependencies': {'jest': '29'}}
for why, files, f, want in [
    ("vitest: coverage.include is not the test include",
     {'package.json': V, 'vitest.config.mjs': "export default {test:{coverage:{include:['src/**']}}}"},
     'test/a.test.ts', (['npx vitest run test/a.test.ts'], [])),
    ("vitest: coverage.include beside a real include still leaves a file outside the include out (control)",
     {'package.json': V, 'vitest.config.mjs': "export default {test:{include:['src/**/*.test.ts'],coverage:{include:['test/**']}}}"},
     'test/a.test.ts', ([], ['test/a.test.ts'])),
    ("vitest: a test block in vite.config.* is vitest's config",
     {'package.json': V, 'vite.config.mjs': "export default {test:{include:['tests/**/*.ts']}}"},
     'tests/unit/a.ts', (['npx vitest run tests/unit/a.ts'], [])),
    ("vitest: vite.config.* of a package that does not use vitest is not read (control)",
     {'package.json': J, 'vite.config.mjs': "export default {test:{include:['tests/**/*.ts']}}"},
     'tests/unit/a.ts', ([], ['tests/unit/a.ts'])),
    ("vitest: each inline project collects on its own",
     {'package.json': V, 'vitest.config.mjs':
      "export default {test:{projects:[{test:{include:['src/**/*.test.ts']}},{test:{include:['it/**/*.it.ts']}}]}}"},
     'it/a.it.ts', (['npx vitest run it/a.it.ts'], [])),
    ("vitest: a file no project includes is still left out (control)",
     {'package.json': V, 'vitest.config.mjs':
      "export default {test:{projects:[{test:{include:['src/**/*.test.ts']}},{test:{include:['it/**/*.it.ts']}}]}}"},
     'e2e/a.it.ts', ([], ['e2e/a.it.ts'])),
    ("vitest: a workspace member without its own config is collected with vitest's defaults",
     {'package.json': V, 'vitest.workspace.ts': "export default ['packages/*']",
      'packages/a/src/x.test.ts': ''},
     'packages/a/src/x.test.ts', (['npx vitest run packages/a/src/x.test.ts'], [])),
    ("vitest: a workspace member's own include is read from the member",
     {'package.json': V, 'vitest.workspace.ts': "export default ['packages/*']",
      'packages/a/vitest.config.ts': "export default {test:{include:['spec/**/*.ts']}}"},
     'packages/a/spec/x.ts', (['(cd packages/a && npx vitest run spec/x.ts)'], [])),
    ("vitest: exclude takes a file back out",
     {'package.json': V, 'vitest.config.mjs':
      "import {configDefaults} from 'vitest/config'\nexport default {test:{exclude:[...configDefaults.exclude,'e2e/**']}}"},
     'e2e/a.spec.ts', ([], ['e2e/a.spec.ts'])),
    ("vitest: a file outside the exclude is kept (control)",
     {'package.json': V, 'vitest.config.mjs':
      "import {configDefaults} from 'vitest/config'\nexport default {test:{exclude:[...configDefaults.exclude,'e2e/**']}}"},
     'src/a.spec.ts', (['npx vitest run src/a.spec.ts'], [])),
    ("vitest: an include this cannot read is not evidence the file is out",
     {'package.json': V, 'vitest.config.ts': "import {inc} from './x'\nexport default {test:{include: inc}}"},
     'weird/a.ts', (['npx vitest run weird/a.ts'], [])),
    ("node:test through `tsx --test` in a glob script",
     {'package.json': {'scripts': {'test:run': 'glob -c "tsx --test" "./test/**/*.ts"'}}},
     'test/routes/api/users/users.test.ts', (['npx tsx --test test/routes/api/users/users.test.ts'], [])),
    ("node:test through `node --test`",
     {'package.json': {'scripts': {'test': 'node --test'}}}, 'test/a.test.js', (['node --test test/a.test.js'], [])),
    ("playwright-only package: playwright runs its spec",
     {'package.json': {'devDependencies': {'@playwright/test': '1'}}}, 'e2e/a.spec.ts',
     (['npx playwright test e2e/a.spec.ts'], [])),
    ("playwright testDir: a spec outside it is not playwright's",
     {'package.json': {'devDependencies': {'@playwright/test': '1'}},
      'playwright.config.ts': "export default defineConfig({ testDir: './e2e' })"}, 'src/a.spec.ts',
     ([], ['src/a.spec.ts'])),
    ("vitest excludes e2e and playwright takes it",
     {'package.json': {'devDependencies': {'vitest': '1', '@playwright/test': '1'}},
      'vitest.config.ts': "export default {test:{exclude:['e2e/**']}}",
      'playwright.config.ts': "export default { testDir: 'e2e' }"}, 'e2e/a.spec.ts',
     (['npx playwright test e2e/a.spec.ts'], [])),
    ("react-scripts runs its own jest",
     {'package.json': {'scripts': {'test': 'react-scripts test'}, 'dependencies': {'react-scripts': '5'}}},
     'src/App.test.js', (['npx react-scripts test --watchAll=false src/App.test.js'], [])),
    ("a package with a package.json and no runner hands nothing to vitest",
     {'package.json': {'name': 'x'}}, 'src/a.test.ts', ([], ['src/a.test.ts'])),
    ("a jest config outranks vitest listed only as a dependency",
     {'package.json': {'scripts': {'test': 'jest'}, 'devDependencies': {'jest': '29', 'vitest': '1'}},
      'jest.config.js': "module.exports = {}"}, 'src/a.test.js', (['npx jest src/a.test.js'], [])),
    ("a vitest config outranks jest listed only as a dependency (control)",
     {'package.json': {'devDependencies': {'jest': '29', 'vitest': '1'}},
      'vitest.config.ts': "export default {}"}, 'src/a.test.js', (['npx vitest run src/a.test.js'], [])),
    ("jest testMatch with <rootDir>",
     {'package.json': J, 'jest.config.js': "module.exports = {testMatch:['<rootDir>/src/**/*.check.js']}"},
     'src/a.check.js', (['npx jest src/a.check.js'], [])),
    ("jest testRegex replaces testMatch",
     {'package.json': J, 'jest.config.js': "module.exports = {testRegex:'\\\\.e2e-spec\\\\.js$'}"},
     'test/app.e2e-spec.js', (['npx jest test/app.e2e-spec.js'], [])),
    ("jest testRegex leaves a default-named file out (control)",
     {'package.json': J, 'jest.config.js': "module.exports = {testRegex:'\\\\.e2e-spec\\\\.js$'}"},
     'src/a.test.js', ([], ['src/a.test.js'])),
    ("jest: package.json key with rootDir + a `jest --config` e2e config in a script",
     {'package.json': {'scripts': {'test': 'jest', 'test:e2e': 'jest --config ./test/jest-e2e.json'},
                       'devDependencies': {'jest': '29'},
                       'jest': {'rootDir': 'src', 'testRegex': '.*\\.spec\\.ts$'}},
      'test/jest-e2e.json': {'rootDir': '.', 'testRegex': '.e2e-spec.ts$'}},
     'test/app.e2e-spec.ts', (['npx jest --config ./test/jest-e2e.json test/app.e2e-spec.ts'], [])),
    ("jest: package.json rootDir src collects its spec (control)",
     {'package.json': {'scripts': {'test': 'jest', 'test:e2e': 'jest --config ./test/jest-e2e.json'},
                       'devDependencies': {'jest': '29'},
                       'jest': {'rootDir': 'src', 'testRegex': '.*\\.spec\\.ts$'}},
      'test/jest-e2e.json': {'rootDir': '.', 'testRegex': '.e2e-spec.ts$'}},
     'src/app.service.spec.ts', (['npx jest src/app.service.spec.ts'], [])),
    ("jest: a [jt] glob is read whole, and a nested e2e/jest.config.ts runs its own files",
     {'package.json': J, 'jest.config.ts': "export default {testMatch:['<rootDir>/src/**/*(*.)@(spec|test).[jt]s?(x)']}",
      'e2e/jest.config.ts': "export default {testMatch:['<rootDir>/src/**/*.spec.ts']}"},
     'e2e/src/server/server.spec.ts', (['(cd e2e && npx jest src/server/server.spec.ts)'], [])),
    ("jest: the root [jt] glob still collects its own src spec (control)",
     {'package.json': J, 'jest.config.ts': "export default {testMatch:['<rootDir>/src/**/*(*.)@(spec|test).[jt]s?(x)']}",
      'e2e/jest.config.ts': "export default {testMatch:['<rootDir>/src/**/*.spec.ts']}"},
     'src/app/a.spec.tsx', (['npx jest src/app/a.spec.tsx'], [])),
    ("a script that only lints the file is not its test command",
     {'package.json': {'scripts': {'lint': 'eslint e2e/run-e2e.ts'}, 'devDependencies': {'vitest': '1'}}},
     'e2e/run-e2e.ts', ([], ['e2e/run-e2e.ts'])),
    ("a test script whose own glob takes the file runs it",
     {'package.json': {'scripts': {'test': 'cross-env NODE_ENV=test babel-tape-runner test/test-*.js'}}},
     'test/test-users.js', (['npm run test'], [])),
    ("a lint script's glob is not a test command (control)",
     {'package.json': {'scripts': {'lint': 'eslint "test/**/*.js"'}}}, 'test/test-users.js', ([], ['test/test-users.js'])),
    ("a package directory with a space is quoted",
     {'my pkg/package.json': V}, 'my pkg/src/a.test.ts', (["(cd 'my pkg' && npx vitest run src/a.test.ts)"], [])),
]:
    d = tree(files)
    check(why, ti.js_plan(d, [f]), want)
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
