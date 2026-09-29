#!/usr/bin/env python3
"""tests/test_command.py — the command test-impact prints runs the selected files, with the runner their project uses.

A Python file is run by its project's runner: `python manage.py test <dotted>` for Django with no pytest, `python -m
unittest` for TestCase modules with no pytest, pytest otherwise; each runner is handed only its own language's files.

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
      ti.command_for('typescript', ['src/a.test.ts'], [], repo=d), 'npx vitest run src/a.test.ts')
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
    # the config is read as the value the file exports, not as the literal keys it spells; what that value does not
    # say is never taken as the runner's defaults
    ("vitest: vitest.config.* outranks vite.config.* (control)",
     {'package.json': V, 'vite.config.mjs': "export default {test:{include:['tests/**/*.ts']}}",
      'vitest.config.mjs': "export default {test:{include:['spec/**/*.ts']}}"},
     'tests/unit/a.ts', ([], ['tests/unit/a.ts'])),
    ("vitest: an include spread from configDefaults keeps the defaults",
     {'package.json': V, 'vitest.config.ts': "import { defineConfig, configDefaults } from 'vitest/config'\n"
      "export default defineConfig({ test: { include: [...configDefaults.include, 'checks/**/*.ts'] } })"},
     'src/a.test.ts', (['npx vitest run src/a.test.ts'], [])),
    ("vitest: test options aliased through a const `{ test }`",
     {'package.json': V, 'vitest.config.ts': "import { defineConfig } from 'vitest/config'\n"
      "const test = { include: ['spec/**/*.ts'] }\nexport default defineConfig({ test })"},
     'spec/a.ts', (['npx vitest run spec/a.ts'], [])),
    ("vitest: the aliased include leaves a default-named file out (control)",
     {'package.json': V, 'vitest.config.ts': "import { defineConfig } from 'vitest/config'\n"
      "const test = { include: ['spec/**/*.ts'] }\nexport default defineConfig({ test })"},
     'src/b.test.ts', ([], ['src/b.test.ts'])),
    ("vitest: include as a shorthand property `{ include }`",
     {'package.json': V, 'vitest.config.ts': "const include: string[] = ['spec/**/*.ts']\n"
      "export default defineConfig({ test: { include } })"},
     'src/b.test.ts', ([], ['src/b.test.ts'])),
    ("vitest: a config re-exported from another file",
     {'package.json': V, 'vitest.config.ts': "export { default } from './config/vitest.shared'\n",
      'config/vitest.shared.ts': "import { defineConfig } from 'vitest/config'\n"
      "export default defineConfig({ test: { include: ['spec/**/*.ts'] } })"},
     'spec/a.ts', (['npx vitest run spec/a.ts'], [])),
    ("vitest: mergeConfig with its base include in another file",
     {'package.json': V, 'vitest.base.ts': "export default defineConfig({ test: { include: ['spec/**/*.ts'] } })",
      'vitest.config.ts': "import { mergeConfig, defineConfig } from 'vitest/config'\nimport base from './vitest.base'\n"
      "export default mergeConfig(base, defineConfig({ test: { exclude: ['spec/skip/**'] } }))"},
     'spec/a.ts', (['npx vitest run spec/a.ts'], [])),
    ("vitest: the merged exclude still takes its file out (control)",
     {'package.json': V, 'vitest.base.ts': "export default defineConfig({ test: { include: ['spec/**/*.ts'] } })",
      'vitest.config.ts': "import { mergeConfig, defineConfig } from 'vitest/config'\nimport base from './vitest.base'\n"
      "export default mergeConfig(base, defineConfig({ test: { exclude: ['spec/skip/**'] } }))"},
     'spec/skip/b.ts', ([], ['spec/skip/b.ts'])),
    ("vitest: an include computed at load time is not read as the defaults",
     {'package.json': V, 'vitest.config.ts': "const include = ['spec'].map(d => d + '/**/*.ts')\n"
      "export default { test: { include } }"},
     'spec/a.ts', (['npx vitest run spec/a.ts'], [])),
    ("vitest: a workspace member configured by its vite.config.ts test block",
     {'package.json': V, 'vitest.workspace.ts': "export default ['packages/*']",
      'packages/a/package.json': {'name': 'a'},
      'packages/a/vite.config.ts': "export default defineConfig({ test: { include: ['tests/**/*.ts'] } })"},
     'packages/a/tests/x.ts', (['npx vitest run packages/a/tests/x.ts'], [])),
    ("vitest: a second config a script names with --config",
     {'package.json': {**V, 'scripts': {'test': 'vitest run', 'test:e2e': 'vitest run --config vitest.e2e.config.ts'}},
      'vitest.config.ts': "export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })",
      'vitest.e2e.config.ts': "export default defineConfig({ test: { include: ['e2e/**/*.e2e.ts'] } })"},
     'e2e/login.e2e.ts', (['npx vitest run --config vitest.e2e.config.ts e2e/login.e2e.ts'], [])),
    ("vitest: test.dir narrows where it looks",
     {'package.json': V, 'vitest.config.ts': "export default defineConfig({ test: { dir: 'src' } })"},
     'test/b.test.ts', ([], ['test/b.test.ts'])),
    ("vitest: test.dir keeps its own files (control)",
     {'package.json': V, 'vitest.config.ts': "export default defineConfig({ test: { dir: 'src' } })"},
     'src/a.test.ts', (['npx vitest run src/a.test.ts'], [])),
    ("jest: a testMatch spread from jest-config's defaults keeps the defaults",
     {'package.json': J, 'jest.config.js': "const { defaults } = require('jest-config')\n"
      "module.exports = { testMatch: [...defaults.testMatch, '**/*.int.js'] }"},
     'src/a.test.js', (['npx jest src/a.test.js'], [])),
    ("jest: a `!glob` in testMatch takes a file back out",
     {'package.json': J, 'jest.config.js': "module.exports = { testMatch: ['**/*.test.js', '!**/fixtures/**'] }"},
     'src/fixtures/a.test.js', ([], ['src/fixtures/a.test.js'])),
    ("jest: the negation keeps every other file (control)",
     {'package.json': J, 'jest.config.js': "module.exports = { testMatch: ['**/*.test.js', '!**/fixtures/**'] }"},
     'src/b.test.js', (['npx jest src/b.test.js'], [])),
    ("jest: collectCoverageFrom is not the test match",
     {'package.json': J, 'jest.config.js': "module.exports = { collectCoverageFrom: ['lib/**/*.js'] }"},
     'test/a.test.js', (['npx jest test/a.test.js'], [])),
    ("jest: nor in the package.json key",
     {'package.json': {**J, 'jest': {'collectCoverageFrom': ['lib/**/*.js'], 'coveragePathIgnorePatterns': ['/test/']}}},
     'test/a.test.js', (['npx jest test/a.test.js'], [])),
    ("jest: a config through a const and an async function",
     {'package.json': J, 'jest.config.ts': "import type { Config } from 'jest'\n"
      "const config: Config = { testMatch: ['**/*.it.ts'] }\nexport default async () => config"},
     'src/a.it.ts', (['npx jest src/a.it.ts'], [])),
    ("mocha: --extension ts --recursive in the script, run with the script's flags",
     {'package.json': {'scripts': {'test': 'mocha --require tsx/cjs --extension ts --recursive test'},
                       'devDependencies': {'mocha': '10'}}},
     'test/unit/a.spec.ts', (['npx mocha --require tsx/cjs --extension ts --recursive test/unit/a.spec.ts'], [])),
    ("mocha: .mocharc.json extension with the default ./test spec",
     {'package.json': {'scripts': {'test': 'mocha'}, 'devDependencies': {'mocha': '10'}},
      '.mocharc.json': {'extension': ['ts'], 'require': 'tsx/cjs'}},
     'test/a.ts', (['npx mocha test/a.ts'], [])),
    ("mocha: without --recursive a nested file is not collected (control)",
     {'package.json': {'scripts': {'test': 'mocha --extension ts test'}, 'devDependencies': {'mocha': '10'}}},
     'test/unit/a.ts', ([], ['test/unit/a.ts'])),
]:
    d = tree(files)
    check(why, ti.js_plan(d, [f]), want)
    shutil.rmtree(d)

# control: other languages are untouched
check("python with nothing to read keeps pytest (control)", ti.command_for('python', ['tests/test_a.py'], []), 'pytest tests/test_a.py')

# a Python test file is run by the runner its project uses: Django's manage.py test, unittest, or pytest
DJ_MANAGE = "import os, sys\nos.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hc.settings')\nfrom django.core.management import execute_from_command_line\n"
UT = "import unittest\nclass T(unittest.TestCase):\n    def test_a(self): pass\n"
DJ_T = "from django.test import TestCase\nclass T(TestCase):\n    def test_a(self): pass\n"
for why, files, sel, want in [
    ("django: manage.py and no pytest anywhere runs manage.py test with dotted labels",
     {'manage.py': DJ_MANAGE, 'requirements.txt': 'Django==5.0\n', 'hc/api/tests/test_check.py': DJ_T},
     ['hc/api/tests/test_check.py'], 'python manage.py test hc.api.tests.test_check'),
    ("django: pytest-django in the requirements keeps pytest (near miss)",
     {'manage.py': DJ_MANAGE, 'requirements-dev.txt': 'pytest-django==4.8\n', 'hc/api/tests/test_check.py': DJ_T},
     ['hc/api/tests/test_check.py'], 'pytest hc/api/tests/test_check.py'),
    ("django: a [tool.pytest.ini_options] section keeps pytest (near miss)",
     {'manage.py': DJ_MANAGE, 'pyproject.toml': '[tool.pytest.ini_options]\nDJANGO_SETTINGS_MODULE = "x"\n', 'app/tests.py': DJ_T},
     ['app/tests.py'], 'pytest app/tests.py'),
    ("django: a conftest.py above the test keeps pytest (near miss)",
     {'manage.py': DJ_MANAGE, 'app/conftest.py': '', 'app/tests/test_x.py': DJ_T},
     ['app/tests/test_x.py'], 'pytest app/tests/test_x.py'),
    ("django: manage.py in a subdirectory runs from there",
     {'src/manage.py': DJ_MANAGE, 'src/requirements.txt': 'Django\n', 'src/shop/tests/test_cart.py': DJ_T},
     ['src/shop/tests/test_cart.py'], '(cd src && python manage.py test shop.tests.test_cart)'),
    ("a manage.py that is not Django's (a Flask CLI) is not a Django runner (near miss)",
     {'manage.py': 'from flask.cli import FlaskGroup\n', 'tests/test_x.py': 'def test_a(): pass\n'},
     ['tests/test_x.py'], 'pytest tests/test_x.py'),
    ("CI that runs manage.py test is read as the runner",
     {'manage.py': DJ_MANAGE, '.github/workflows/ci.yml': 'run: python manage.py test\n', 'requirements.txt': 'Django\n',
      'a/tests.py': DJ_T}, ['a/tests.py'], 'python manage.py test a.tests'),
    ("unittest: TestCase modules with no pytest anywhere run under python -m unittest",
     {'setup.py': 'from setuptools import setup\n', 'tests/test_x.py': UT}, ['tests/test_x.py'], 'python -m unittest tests.test_x'),
    ("unittest: tox that runs -m unittest is read as the runner",
     {'tox.ini': '[testenv]\ncommands = python -m unittest discover\n', 'tests/test_x.py': UT}, ['tests/test_x.py'],
     'python -m unittest tests.test_x'),
    ("unittest: a test importing pytest keeps pytest (near miss)",
     {'setup.py': '', 'tests/test_x.py': 'import pytest, unittest\nclass T(unittest.TestCase): pass\n'},
     ['tests/test_x.py'], 'pytest tests/test_x.py'),
    ("unittest: a bare def test_ needs pytest (near miss)",
     {'setup.py': '', 'tests/test_x.py': 'def test_a(): pass\n'}, ['tests/test_x.py'], 'pytest tests/test_x.py'),
    ("a test script (no test function, exits on its own) is run as a program, the tests beside it with pytest",
     {'pyproject.toml': '[project]\ndependencies = ["pytest"]\n', 'tests/test_x.py': 'def test_a(): pass\n',
      'tests/test_cmd.py': 'import sys\nfails = 0\nsys.exit(1 if fails else 0)\n'},
     ['tests/test_cmd.py', 'tests/test_x.py'], 'pytest tests/test_x.py\npython tests/test_cmd.py'),
    ("a module under a test tree that declares no test and runs as no program is on no command line",
     {'pyproject.toml': '[project]\ndependencies = ["pytest"]\n', 'tests/test_x.py': 'def test_a(): pass\n',
      'tests/cases/shop/pricing.py': 'def price(q):\n    return q\n'},
     ['tests/cases/shop/pricing.py', 'tests/test_x.py'], 'pytest tests/test_x.py'),
    ("a runner only gets files of its language: a .cs and a .ts fixture are left off the pytest line",
     {'pyproject.toml': '[project]\ndependencies = ["pytest"]\n', 'tests/test_x.py': ''},
     ['tests/test_x.py', 'tests/cases/Foo.cs', 'tests/cases/a.ts'], 'pytest tests/test_x.py'),
]:
    d = tree(files)
    check(why, ti.command_for('python', sel, [], None, d), want)
    shutil.rmtree(d)
# the by-name tier: a stem every package repeats names no module's tests
d = tree({'app/__init__.py': '', 'app/pricing.py': '', 'app/__main__.py': '', 'tests/__init__.py': '',
          'tests/test_pricing.py': 'def test_a(): pass\n', 'tests/sub/__init__.py': '', 'tests/conftest.py': ''})
check("an edit to __init__.py or __main__.py names no test file by name", ti.package_tier(d, ['app/__init__.py', 'app/__main__.py'])[1], {})
check("an edit to pricing.py still names test_pricing.py (control)", ti.package_tier(d, ['app/pricing.py'])[1],
      {'files': ['tests/test_pricing.py']})
shutil.rmtree(d)
# the by-name tier holds only tests by the changed file's own ecosystem: a fixture input under a test tree, another
# language's test and the changed file itself share the name but are counted, never offered or run
d = tree({'src/index.js': '', 'test/fixtures/basic/index.js': '', 'test/fixtures/esm/index.js': '',
          'tests/test_index.py': '', 'test/index.test.js': '', 'test/server.js': '', 'test/fixtures/app/server.js': '',
          'src/server.ts': '', 'src/schema.ts': '', 'test/fixtures/schema.ts': '', 'test/schema.spec.ts': '',
          'test/app.ts': '', 'test/fixtures/app/index.js': ''})
check("fixture inputs and another language's test are not the tests of src/index.js",
      ti.package_tier(d, ['src/index.js'])[1], {'files': ['test/index.test.js'], 'not_tests': 4})
check("a .spec.ts names schema.ts; the fixture schema.ts is counted, not offered",
      ti.package_tier(d, ['src/schema.ts'])[1], {'files': ['test/schema.spec.ts'], 'not_tests': 1})
check("a file directly in test/ is a mocha test of server.ts (control); the nested fixture server.js is not",
      ti.package_tier(d, ['src/server.ts'])[1], {'files': ['test/server.js'], 'not_tests': 1})
check("a changed test-tree file is not its own test", ti.package_tier(d, ['test/fixtures/basic/index.js'])[1].get('files'),
      ['test/index.test.js'])
shutil.rmtree(d)
d = tree({'src/main/java/a/Parser.java': '', 'src/test/java/a/ParserTest.java': '', 'src/test/java/a/TestParser.java': '',
          'src/test/resources/cases/Parser.java': '', 'tests/test_parser.py': '', 'src/test/java/a/Testimonial.java': ''})
check("java: ParserTest and TestParser are Parser's tests; a resource Parser.java is not",
      ti.package_tier(d, ['src/main/java/a/Parser.java'])[1],
      {'files': ['src/test/java/a/ParserTest.java', 'src/test/java/a/TestParser.java'], 'not_tests': 1})
shutil.rmtree(d)
# the text tier: a directory of a changed data file is named by a test only where the test writes it as THAT directory.
# A path segment is not a phrase match: `cases` inside another tree's path, a @MethodSource("cases"), a dict key or a
# comment names some other `cases`, and matched every test of the repository
CASE = 'graph/test/java/cases/70-orders/src/derived/Order.java'
d = tree({'graph/test/java/tools/runner.py': "CASES = os.path.join(os.path.dirname(HERE), 'cases')\n",
          'graph/test/java/check_cases.py': "for c in glob.glob('cases/*/src/**', recursive=True): pass\n",
          'tests/test_paths.py': "ROOT = 'graph/test/java/cases/'\n",
          'tests/cases/python/x/test_a.py': "p = os.path.join(HERE, 'tests', 'cases', 'python')\n",
          'tests/test_other_tree.py': "fx = 'test/python/cases/10-async'\n",
          'src/test/java/a/RatesTest.java': '@MethodSource("cases")\nvoid rates() {}\n',
          'tests/test_prose.py': "# the derived/ and test/java/cases layouts differ\nkinds = {'derived': 1}\n",
          'tests/test_join_other.py': "base = os.path.join(ROOT, 'build', 'derived')\n"})
got = ti.loaders(d, {CASE: False})
check("a data file under cases/ is named by the runner beside it, a glob below it and its full path; not by another "
      "tree's path, an annotation value, a dict key, a comment or a join under another root",
      (got[CASE][0], got[CASE][1]), ('cases', ['graph/test/java/check_cases.py', 'graph/test/java/tools/runner.py', 'tests/test_paths.py']))
check("names_dir: a glob below the directory must match what lies below it (control)",
      ti.names_dir(CASE, 'cases', 't.py', "glob('cases/*/case.json')"), False)
check("names_dir: a path written with its own parents agrees (control)",
      ti.names_dir(CASE, 'derived', 'tests/t.py', "p = 'java/cases/70-orders/src/derived'"), True)
check("names_dir: the same word under another parent does not",
      ti.names_dir(CASE, 'derived', 'tests/t.py', "p = 'python/cases/70-orders/src/derived'"), False)
shutil.rmtree(d)
check("a runner given only another language's files prints no command", ti.command_for('python', ['tests/Foo.cs'], [], None, '.'), None)
check("java drops a .py file from a file-named selection", ti.command_for('java', ['src/test/java/ATest.java', 'tests/test_a.py'], []),
      'mvn test -Dtest=ATest')
check("csharp drops a .java file from a file-named selection", ti.command_for('csharp', ['T/ATests.cs', 'x/BTest.java'], []),
      'dotnet test --filter "FullyQualifiedName~ATests"')
for lang, rel, want in [('python', 'tests/test_a.py', True), ('python', 'tests/cases/fixture.py', False),
                        ('python', 'tests/cases/Foo.cs', False), ('java', 'src/test/java/ATest.java', True),
                        ('java', 'tests/test_a.py', False), ('csharp', 'T/ATests.cs', True)]:
    check(f"collected_by({lang}, {rel}) is {want}", ti.collected_by(lang, rel), want)
check("java unchanged (control)", ti.command_for('java', [], ['app.ATest']), 'mvn test -Dtest=ATest')

# the next: line names every command, and still names a single one as it did
check("next: one command is named as before (control)",
      ax_pages.next_test_impact("\n  npx vitest run src/a.test.ts\n").split(' — ')[0], 'next: run npx vitest run src/a.test.ts')
check("next: a (cd pkg && …) command is recognised",
      ax_pages.next_test_impact("\n  (cd parser && npx tsx src/test/a-tests.ts)\n").split(' — ')[0],
      'next: run (cd parser && npx tsx src/test/a-tests.ts)')
check("next: a manage.py test command is recognised",
      ax_pages.next_test_impact("\n  python manage.py test hc.api.tests.test_x\n").split(' — ')[0],
      'next: run python manage.py test hc.api.tests.test_x')
check("next: a python -m unittest command is recognised",
      ax_pages.next_test_impact("\n  (cd src && python -m unittest a.test_b)\n").split(' — ')[0],
      'next: run (cd src && python -m unittest a.test_b)')
check("next: a test script run as a program is recognised",
      ax_pages.next_test_impact("\n  python tests/test_cmd.py\n").split(' — ')[0], 'next: run python tests/test_cmd.py')
check("next: several commands are counted",
      ax_pages.next_test_impact("\n  (cd p && npx tsx a.ts)\n  (cd p && npx tsx b.ts)\n").startswith('next: run the 2 commands above'),
      True)

print('\n' + ('all passed' if not fails else f"{fails} FAILED"))
sys.exit(1 if fails else 0)
