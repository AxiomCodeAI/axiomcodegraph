/**
 * DISCOVERY TESTS — project discovery across languages.
 *
 *     npx tsx src/test/discovery-tests.ts            # everything
 *     npx tsx src/test/discovery-tests.ts --list     # what runs, and what it proves
 *
 * NO JVM, NO NETWORK. Each check builds a throwaway repository under the OS
 * temp directory and runs the real `ProjectScanner` over it.
 *
 * ## What this suite is for
 *
 * `extractProject` partitions discovered projects by language and hands each
 * list to its analyzer, so a language that discovery misses is never extracted
 * at all — and misses silently, because an analyzer given an empty list writes
 * nothing and reports nothing. Every check here is written against a repository
 * LAYOUT rather than against parser output, and each names the implementation
 * it rules out; a check that no plausible implementation fails proves nothing.
 *
 * The two implementations these rule out are the two that were actually shipped:
 * a scanner that stops descending at the first match, and a detector that
 * returns only the first language that claims a directory.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { extractProject } from '@/extract';
import { ProjectLanguage } from '@/types/ProjectInfo';
import { resolveFileOwners } from '@/utils/file-ownership';
import { ProjectScanner } from '@/utils/project-scanner';

interface Check {
  name: string;
  proves: string;
  rulesOut: string;
  run: (root: string) => Promise<string | null>;
}

/** Writes `files` (path → contents) under a fresh temp root and returns it. */
function build(tmp: string, name: string, files: Record<string, string>): string {
  const root = path.join(tmp, name);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return root;
}

const POM = '<project><groupId>g</groupId><artifactId>a</artifactId><version>1</version></project>';
const JAVA = 'package com.x;\npublic class Foo { public int bar(int a) { return a + 1; } }\n';
const PY = 'def hello(n):\n    return n + 1\n';
const TS = 'export function greet(name: string): string { return `hi ${name}`; }\n';

/** Languages discovered under `root`, deduplicated and sorted. */
async function languagesIn(root: string): Promise<string[]> {
  const projects = await new ProjectScanner().scanForProjects(root);
  return [...new Set(projects.map((p) => p.language))].sort();
}

/** Every discovered project as `LANGUAGE @ path-relative-to-root`, sorted. */
async function projectsIn(root: string): Promise<string[]> {
  const projects = await new ProjectScanner().scanForProjects(root);
  return projects
    .map((p) => `${p.language} @ ${path.relative(root, p.path) || '.'}`)
    .sort();
}

const POLYGLOT: Record<string, string> = {
  'svc-java/pom.xml': POM,
  'svc-java/src/main/java/com/x/Foo.java': JAVA,
  'svc-py/main.py': PY,
  'svc-ts/tsconfig.json': '{"compilerOptions":{"target":"ES2020"}}',
  'svc-ts/src/a.ts': TS,
};

const ALL_THREE = [ProjectLanguage.JAVA, ProjectLanguage.PYTHON, ProjectLanguage.TYPESCRIPT].sort();

const CHECKS: Check[] = [
  {
    name: 'siblings-are-all-found',
    proves: 'three single-language services side by side are three projects',
    rulesOut: 'nothing on its own — it is the control for root-manifest-does-not-swallow-siblings',
    run: async (tmp) => {
      const found = await languagesIn(build(tmp, 'siblings', POLYGLOT));
      return String(found) === String(ALL_THREE) ? null : `found ${found}, want ${ALL_THREE}`;
    },
  },
  {
    name: 'root-manifest-does-not-swallow-siblings',
    proves: 'a parent POM over a polyglot tree does not reduce it to one Java project',
    rulesOut: 'a scanner that returns as soon as a directory claims to be a project',
    run: async (tmp) => {
      const found = await languagesIn(build(tmp, 'parent-pom', { ...POLYGLOT, 'pom.xml': POM }));
      return String(found) === String(ALL_THREE)
        ? null
        : `found ${found}, want ${ALL_THREE} — the parent POM swallowed the other services`;
    },
  },
  {
    name: 'one-directory-can-be-several-languages',
    proves: 'a Java service with Python and TypeScript tooling beside it is all three',
    rulesOut: 'a detector that returns only the first language claiming a directory',
    run: async (tmp) => {
      const found = await languagesIn(build(tmp, 'mixed-dir', {
        'pom.xml': POM,
        'src/main/java/com/x/Foo.java': JAVA,
        'scripts/deploy.py': PY,
        'scripts/tool.ts': TS,
      }));
      return String(found) === String(ALL_THREE) ? null : `found ${found}, want ${ALL_THREE}`;
    },
  },
  {
    name: 'a-module-below-a-different-language-root-is-found',
    proves: 'a Maven module under a TypeScript root is still discovered as Java',
    rulesOut: 'a scanner that stops at the root because tsconfig.json claimed it',
    run: async (tmp) => {
      const found = await languagesIn(build(tmp, 'ts-root', {
        'tsconfig.json': '{"compilerOptions":{"target":"ES2020"}}',
        'src/a.ts': TS,
        'backend/pom.xml': POM,
        'backend/src/main/java/com/x/Foo.java': JAVA,
      }));
      const want = [ProjectLanguage.JAVA, ProjectLanguage.TYPESCRIPT].sort();
      return String(found) === String(want) ? null : `found ${found}, want ${want}`;
    },
  },
  {
    name: 'nested-same-language-is-recorded-once',
    proves: 'a Maven multi-module build stays one Java project, at the outermost POM',
    rulesOut: 'descending past a match WITHOUT suppressing a language an ancestor already covers — '
      + 'every analyzer walks its root recursively, so recording the modules too parses each file '
      + 'once per containing project and emits every row that many times',
    run: async (tmp) => {
      const found = await projectsIn(build(tmp, 'multi-module', {
        'pom.xml': POM,
        'mod-a/pom.xml': POM,
        'mod-a/src/main/java/com/x/A.java': 'package com.x;\npublic class A {}\n',
        'mod-b/pom.xml': POM,
        'mod-b/src/main/java/com/x/B.java': 'package com.x;\npublic class B {}\n',
      }));
      return String(found) === String([`${ProjectLanguage.JAVA} @ .`])
        ? null
        : `found ${found}, want exactly the root Java project`;
    },
  },
  {
    name: 'a-tsconfig-directory-with-loose-js-files-is-a-javascript-root-too',
    proves: 'a directory holding tsconfig.json AND its own .js files is claimed for JavaScript beside TypeScript, at the root and in a nested package, while a tsconfig directory with no loose .js file is not',
    rulesOut: 'a tsconfig.json disqualifying the directory for JavaScript outright: the TypeScript '
      + 'analyzer emits nothing for .js program members and no descendant JavaScript project '
      + 'covers the directory\'s own files, so the package entry points vanished from every IR '
      + 'folder with no skip row (#595)',
    run: async (tmp) => {
      const root = build(tmp, 'tsconfig-root', {
        'package.json': '{"name":"x","version":"1.0.0"}',
        'tsconfig.json': '{"compilerOptions":{"allowJs":true,"checkJs":true,"noEmit":true},"include":["lib"]}',
        'index.js': "const { greet } = require('./lib/greet'); greet('a');\n",
        'lib/greet.js': 'function greet(n) { return n; }\nmodule.exports = { greet };\n',
        'packages/pkg/package.json': '{"name":"pkg"}',
        'packages/pkg/tsconfig.json': '{"compilerOptions":{"allowJs":true}}',
        'packages/pkg/update-package-json.js': 'module.exports = 1;\n',
        'packages/pkg/src/a.ts': TS,
        'packages/pure/tsconfig.json': '{"compilerOptions":{"target":"ES2020"}}',
        'packages/pure/src/a.ts': TS,
      });
      const found = await projectsIn(root);
      const js = found.filter((p) => p.startsWith(`${ProjectLanguage.JAVASCRIPT} @ `));
      // the root's own walk covers lib/ and packages/pkg/, so they are not roots of their own
      if (String(js) !== String([`${ProjectLanguage.JAVASCRIPT} @ .`])) return `JavaScript roots ${js}, want the root alone`;
      if (!found.includes(`${ProjectLanguage.TYPESCRIPT} @ .`)) return `the root lost its TypeScript claim: ${found}`;
      // a pure TypeScript root: only the nested package with a loose .js file is JavaScript
      const nested = await projectsIn(build(tmp, 'tsconfig-nested', {
        'tsconfig.json': '{"compilerOptions":{"target":"ES2020"}}',
        'src/a.ts': TS,
        'packages/pkg/package.json': '{"name":"pkg"}',
        'packages/pkg/tsconfig.json': '{"compilerOptions":{"allowJs":true}}',
        'packages/pkg/update-package-json.js': 'module.exports = 1;\n',
        'packages/pkg/src/a.ts': TS,
        'packages/pure/tsconfig.json': '{"compilerOptions":{"target":"ES2020"}}',
        'packages/pure/src/a.ts': TS,
      }));
      const nestedJs = nested.filter((p) => p.startsWith(`${ProjectLanguage.JAVASCRIPT} @ `));
      if (String(nestedJs) !== String([`${ProjectLanguage.JAVASCRIPT} @ packages/pkg`])) return `nested: JavaScript roots ${nestedJs}, want packages/pkg alone`;
      return null;
    },
  },
  {
    name: 'exclude-tests-keeps-a-test-directory-from-becoming-a-root',
    proves: 'with excludeTests, test/, tests/, __tests__/ and e2e/ are not project roots, and src/ still is',
    rulesOut: 'excluding test names only while walking BELOW a root — a test directory that '
      + 'discovery had already registered as its own root was walked from inside, where its '
      + 'name is never seen, and the flag excluded nothing for three of the four languages (#613)',
    run: async (tmp) => {
      const layout = {
        'package.json': '{"name":"mini","version":"1.0.0"}',
        'src/a.js': 'function a(){ return 1; }\nmodule.exports = { a };\n',
        'test/a.test.js': 'const { a } = require("../src/a"); a();\n',
        '__tests__/b.js': 'const { a } = require("../src/a"); a();\n',
        'tests/c.js': 'const { a } = require("../src/a"); a();\n',
        'e2e/d.js': 'const { a } = require("../src/a"); a();\n',
        'src/s.ts': TS,
        'test/s.test.ts': 'import { s } from "../src/s"; s();\n',
        'src/p.py': PY,
        'test/p_test.py': 'from src.p import p\np()\n',
      };
      const root = build(tmp, 'exclude-tests', layout);
      const withTests = (await new ProjectScanner().scanForProjects(root)).map((p) => path.relative(root, p.path) || '.');
      const without = (await new ProjectScanner().scanForProjects(root, 3, true)).map((p) => path.relative(root, p.path) || '.');
      const testRoots = (list: string[]) => list.filter((p) => /^(test|tests|__tests__|e2e)(\/|$)/.test(p));
      if (testRoots(withTests).length === 0) return `control: without the flag no test directory became a root (${withTests}) — the check proves nothing`;
      if (testRoots(without).length > 0) return `with excludeTests these test directories are still roots: ${testRoots(without)}`;
      if (!without.some((p) => p === '.' || p.startsWith('src'))) return `with excludeTests the source itself vanished: ${without}`;
      return null;
    },
  },
  {
    name: 'per-language-keeps-the-javascript-of-a-package-that-is-no-project',
    proves: 'extractProject in per-language layout writes javascript/ for a package whose only '
      + 'JavaScript is the dist/ its package.json ships from, which discovery does not call a project',
    rulesOut: 'choosing the javascript/ folder by whether discovery found a JavaScript project: the '
      + 'analyzer walked dist/ regardless (#620), wrote the tables to a scratch folder, and the '
      + 'scratch folder was deleted as a stray, so the package staged nothing through --library (#709)',
    run: async (tmp) => {
      const root = build(tmp, 'dist-only', {
        'package.json': '{"name":"distpkg","version":"1.0.0","main":"dist/index.js"}',
        'dist/index.js': 'exports.connect = function connect(opts) { return opts; };\n',
      });
      if ((await languagesIn(root)).length !== 0) return 'control: discovery found a project here, so the check exercises nothing';
      const out = path.join(tmp, 'dist-only-out');
      const silence = console.log;
      console.log = () => {};
      try {
        await extractProject({ projectPath: root, versionLink: 'v1', outputDir: out, layout: 'per-language' });
      } finally {
        console.log = silence;
      }
      const folders = fs.readdirSync(out).sort();
      if (String(folders) !== 'javascript') return `output folders ${JSON.stringify(folders)}, want javascript alone`;
      const modules = fs.readFileSync(path.join(out, 'javascript', 'all-javascript-modules.csv'), 'utf-8').trim().split('\n');
      if (modules.length !== 2 || !modules[1]!.includes('dist/index.js')) return `javascript/all-javascript-modules.csv has ${modules.length - 1} row(s), want the one for dist/index.js`;
      return null;
    },
  },
  {
    name: 'ownership-attributes-a-file-to-its-innermost-project',
    proves: 'overlapping scan targets yield one owner per file, the most specific one',
    rulesOut: 'analysing each target independently, which emits the file once per containing '
      + 'target with a different baseMservPath — and therefore a different unique hash — each time',
    run: async (tmp) => {
      const root = build(tmp, 'ownership', { 'core/pom.xml': POM });
      const file = path.join(root, 'core', 'pom.xml');
      const target = (p: string) => ({
        name: path.basename(p), path: p, language: ProjectLanguage.JAVA, hasSourceFiles: true,
      });
      // The root walk and the sub-project walk both reach the same file.
      const owners = await resolveFileOwners(
        [target(root), target(path.join(root, 'core'))],
        async (dir) => (file.startsWith(dir) ? [file] : [])
      );
      if (owners.size !== 1) return `${owners.size} owned file(s), want 1`;
      const owner = owners.get(file)?.path;
      return owner === path.join(root, 'core')
        ? null
        : `attributed to ${owner}, want the enclosing core project`;
    },
  },
];

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    for (const c of CHECKS) {
      console.log(`${c.name}\n  proves:    ${c.proves}\n  rules out: ${c.rulesOut}\n`);
    }
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-tests-'));
  let failures = 0;

  for (const check of CHECKS) {
    let problem: string | null;
    try {
      problem = await check.run(tmp);
    } catch (error) {
      problem = `threw: ${error}`;
    }
    if (problem) {
      failures += 1;
      console.log(`  ✗ ${check.name}\n      ${problem}`);
    } else {
      console.log(`  ✓ ${check.name}`);
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(failures === 0
    ? '\n✅ all discovery checks passed'
    : `\n❌ ${failures} discovery check failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
