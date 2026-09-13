/**
 * Promote `src/test-data/javascript/staging/` into `src/test-data/javascript/categories/`.
 *
 *     node tools/javascript/promote-fixtures.mjs [--check]
 *
 * ## Why this is a script and not a one-off copy
 *
 * `staging/` belongs to `js-fixtures` and is still growing — it went 86 -> 95
 * files during the sweep that produced `categories/`. A hand-copy forks the tree
 * and the fork drifts silently, which is the worst of both. This script makes the
 * promotion a pure function of `staging/`: re-run it after any `js-fixtures`
 * commit and the categories tree is re-derived, with `--check` reporting drift
 * instead of writing.
 *
 * ## What "named to match src/test-data/java/" means here
 *
 * Java's convention is flat kebab-case category directories under the language
 * root. Where a Java category exists and applies, the name is reused exactly:
 * `blocks`, `enums`, `expressions`, `imports`, `integration`, `local-variables`,
 * `methods`, `modules`, `type-registry`. Where JavaScript has a construct Java
 * does not, a new directory is added in the same style rather than forced into an
 * ill-fitting Java name: `call-forms`, `directives`, `exports`, `flow`,
 * `hoisting`, `jsdoc`, `jsx`, `prototypes`.
 *
 * Java's `annotations`, `type-parameters` and `method-type-parameters` have no
 * JavaScript analogue and are deliberately absent. That is recorded here so the
 * absence reads as a decision rather than an oversight.
 *
 * ## The governing package.json travels with the fixture — this is not cosmetic
 *
 * A JavaScript fixture's meaning depends on the nearest ancestor `package.json`'s
 * `"type"` field (§3 of BUILDING-JAVASCRIPT.md). Flattening `cjs/imports/` and
 * `esm/imports/` into one `imports/` directory under one config would silently
 * convert every ESM fixture into an ESM_SYNTAX_UNDER_COMMONJS contradiction and
 * destroy the thing it tests. So each category that needs both systems carries an
 * `esm/` subdirectory with its own `package.json`, and the root config declares
 * `"type": "commonjs"` EXPLICITLY — not by omission, because
 * `modules/pkg-absent-type/` is the sole cover for PKG_TYPE_ABSENT_DEFAULT and an
 * omitted root type would make that value indistinguishable from the default.
 *
 * ## No expectations are written
 *
 * Source only, exactly as staging. Nothing here states what the parser should
 * emit; the oracle remains the sole author of that. `COVERAGE.md` beside the tree
 * is REGENERATED from a parser run, never hand-edited.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const ROOT = path.resolve(path.join(import.meta.dirname, '..', '..'));
const STAGING = path.join(ROOT, 'src/test-data/javascript/staging');
const CATEGORIES = path.join(ROOT, 'src/test-data/javascript/categories');
const CHECK = process.argv.includes('--check');

/**
 * staging path -> category path. First matching rule wins; order matters.
 *
 * `cjs/commonjs/` is the one directory that is SPLIT rather than renamed: it
 * holds both import edges and export edges, and those are different categories
 * everywhere else in this tree.
 */
const RULES = [
  [/^cjs\/commonjs\/(require-|destructured-require|conditional-require|reexport-require|circular-)/, (f) => `imports/${path.basename(f)}`],
  [/^cjs\/commonjs\//, (f) => `exports/${path.basename(f)}`],
  [/^cjs\/(blocks|call-forms|directives|enums|expressions|hoisting|integration|jsdoc|local-variables|methods|prototypes|type-registry)\//,
    (f) => f.replace(/^cjs\//, '')],
  // provenance is a property of the MODULE row (sourceProvenance), so it files under
  // modules/ beside the other module-level categories; the file NAME is the fixture
  // (one per alternate of JS_MINIFIED_NAME_PATTERN) and must survive the move intact.
  [/^cjs\/provenance\//, (f) => `modules/provenance/${path.basename(f)}`],
  [/^esm\/imports\//, (f) => `imports/esm/${f.replace(/^esm\/imports\//, '')}`],
  [/^esm\/exports\//, (f) => `exports/esm/${path.basename(f)}`],
  [/^esm\//, (f) => `modules/esm/${path.basename(f)}`],
  [/^exports-map\//, (f) => `modules/exports-map/${f.replace(/^exports-map\//, '')}`],
  [/^ext\//, (f) => `modules/ext/${f.replace(/^ext\//, '')}`],
  [/^mismatch\//, (f) => `modules/mismatch/${f.replace(/^mismatch\//, '')}`],
  [/^pkg-absent-type\//, (f) => `modules/pkg-absent-type/${path.basename(f)}`],
  [/^flow\//, (f) => f],
  [/^jsx\//, (f) => f],
];

/** Configs minted by the promotion, because the category layout is not staging's. */
const CONFIGS = {
  'package.json': { name: 'javascript-categories', type: 'commonjs' },
  'imports/esm/package.json': { name: 'javascript-categories-imports-esm', type: 'module' },
  'exports/esm/package.json': { name: 'javascript-categories-exports-esm', type: 'module' },
  'modules/esm/package.json': { name: 'javascript-categories-modules-esm', type: 'module' },
  'flow/package.json': { name: 'javascript-categories-flow', type: 'module' },
  'jsx/package.json': { name: 'javascript-categories-jsx', type: 'commonjs' },
};

/**
 * Fixtures this promotion ADDS, because the enum-emission audit over the union of
 * a 4,529-file corpus and the 95-file staging tree found the value reachable and
 * uncovered. One file, one reason, stated in the file.
 */
const ADDITIONS = {
  'blocks/class-static-block.js': `// JsBlockKind.CLASS_STATIC_BLOCK — declared, documented \`static { ... }\`, zero rows.
//
// The column-scoped enum audit found this and the whole-cell audit could not:
// the string CLASS_STATIC_BLOCK IS emitted corpus-wide, in js_scope.scopeKind,
// so exact-cell matching marks the value covered on another enum's evidence.
// js_block carries 17 kinds and 148,000 rows and none of them is this one.
//
// It is the TypeScript NAMESPACE_BODY / MODULE_BODY defect exactly: a body that
// produces a scope and no block row. The control is in the same file — the class
// body, the method bodies and the module body all produce blocks.
//
// module system: CommonJS, governed by categories/package.json.
'use strict';

class Registry {
  static entries = [];

  static {
    // Runs at class-definition time, in its own scope, with its own \`this\`.
    Registry.entries.push('bootstrap');
  }

  static {
    // Two of them, because one wrapper that survives a single occurrence and
    // collapses on the second is the failure this file also has to catch.
    Registry.entries.push('second');
  }

  add(name) {
    { // a plain nested block, the control
      Registry.entries.push(name);
    }
    return Registry.entries.length;
  }
}

module.exports = { Registry };
`,

  'imports/esm/import-binding-alias.js': `// JsInitializerKind.IMPORT_BINDING — declared, and the CommonJS twin emits 12,345 times.
//
// \`REQUIRE_CALL\` is documented as "the name is a module alias" and is emitted for
// \`const x = require('y')\`. \`IMPORT_BINDING\` is documented as "a name bound by an
// import declaration. Also a module alias, by the other route" and is emitted
// never. Both spellings alias a module binding; an engine that can see one and
// not the other sees half the module graph's aliases.
//
// Two readings are covered here because the schema does not say which is meant,
// and both currently produce something other than IMPORT_BINDING:
//   (a) the variable minted FOR the import binding itself  -> initializerKind NONE
//   (b) a local initialised FROM an import binding          -> initializerKind OTHER
//
// module system: ESM, governed by imports/esm/package.json ("type": "module").
import { readFile } from 'node:fs';
import defaultExport from './pkg/util.js';
import * as namespaceBinding from './pkg/util.js';

// (b) — a local whose initializer IS an import binding.
const aliasOfNamed = readFile;
const aliasOfDefault = defaultExport;
const aliasOfNamespace = namespaceBinding;

// The control, in the same file: a local initialised from something that is not
// a module binding at all.
const notAnAlias = { readFile };

export { aliasOfNamed, aliasOfDefault, aliasOfNamespace, notAnAlias };
`,

  'directives/module-attached-comments.js': `#!/usr/bin/env node
/*!
 * JsCommentAttachmentKind.MODULE — declared, zero rows.
 *
 * The enum's own docstring names exactly three things: "a file-level comment: a
 * licence header, a @flow pragma, a shebang". This file has the licence header
 * and the shebang; flow/flow-pragma.js has the third. All of them are emitted
 * with attachedToKind = NONE.
 *
 * NONE is the value for "not attached to anything", and a file-level comment IS
 * attached to something — the module. Collapsing the two loses the distinction
 * between a licence header and a stray comment in the middle of a function, which
 * is the distinction the value exists to make.
 *
 * MODULE was invisible to whole-cell matching because the string MODULE is also a
 * value of JsScopeKind and of JsBindingResolution, and both of those emit.
 *
 * module system: CommonJS, governed by categories/package.json.
 */
'use strict';

// A comment attached to a variable — the control.
const attachedToAVariable = 1;

/** A JSDoc attached to a method — the second control. */
function attachedToAMethod() { return attachedToAVariable; }

module.exports = { attachedToAMethod };
`,

  'jsdoc/this-annotation.js': `// JsTypeReferenceContextKind.THIS — declared as "@this {T}, the receiver's
// declared type, which nothing else can state", and emitted zero times.
//
// This is the one JSDoc tag with no other channel. A parameter type has @param, a
// return has @returns, a field has @type — all three emit js_type_reference rows
// with contextKind PARAM / RETURN / FIELD. The receiver of a plain function has
// only @this, and in the prototype-era code where \`this\` is genuinely ambiguous
// it is the only declaration of the receiver's type anywhere in the program.
//
// The controls are in this file on purpose: @param and @returns on the SAME
// function do emit, so a run that shows PARAM and RETURN and no THIS is showing
// the tag and not the file.
//
// module system: CommonJS, governed by categories/package.json.
'use strict';

/**
 * @param {string} name
 * @returns {string}
 */
function Widget(name) { this.name = name; return name; }

/**
 * @this {Widget}
 * @param {string} suffix
 * @returns {string}
 */
function render(suffix) { return this.name + suffix; }

/** @this {Widget} */
function bareThis() { return this.name; }

Widget.prototype.render = render;
Widget.prototype.bareThis = bareThis;

module.exports = { Widget };
`,

  'modules/import-equals.js': `// JsImportForm.IMPORT_EQUALS — declared, emittable, and covered by nothing else.
//
// \`import x = require('y')\` is TypeScript syntax and NOT JavaScript: Node throws
// on it. \`ts.createSourceFile\` under ScriptKind.JS parses it with ZERO
// diagnostics into an ImportEqualsDeclaration, so the parser mints a js_import
// with importForm = IMPORT_EQUALS for a program that cannot run.
//
// That is the point of the fixture. It sits beside flow/flow-annotations.js as
// the second member of a class worth naming: syntax the JavaScript grammar does
// not have, which the shared TypeScript parse layer accepts silently in a .js
// file. Neither a 4,529-file real-code corpus nor the staging tree contains one,
// because no real .js file is written this way — which is exactly why the value
// needs a fixture rather than a corpus.
//
// module system: CommonJS, governed by categories/package.json ("type": "commonjs").
import nodePath = require('path');

const joined = nodePath.join('a', 'b');

module.exports = { joined };
`,
};

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

const sources = walk(STAGING).filter((f) => /\.(js|mjs|cjs|jsx)$/.test(f)).sort();
const mapping = [];
const unmapped = [];
for (const f of sources) {
  const rule = RULES.find(([re]) => re.test(f));
  if (!rule) { unmapped.push(f); continue; }
  mapping.push([f, rule[1](f)]);
}
if (unmapped.length) {
  console.error('UNMAPPED staging files — a new staging directory needs a rule, and being '
    + 'silently dropped is how a fixture stops covering anything:');
  for (const f of unmapped) console.error('  ' + f);
  process.exit(1);
}

const targets = mapping.map(([, t]) => t);
const dupes = targets.filter((t, i) => targets.indexOf(t) !== i);
if (dupes.length) { console.error('two staging files map to one target:', dupes); process.exit(1); }

const want = new Map();
for (const [src, dst] of mapping) want.set(dst, fs.readFileSync(path.join(STAGING, src)));
// ADDITIONS get the fixture header DERIVED at generation time, with the gate's
// own predicate, so a regenerated tree can never strip it and a human never
// types the label. Same rule as tools/javascript/fixture-headers.mjs.
const ts = createRequire(import.meta.url)('typescript');
const withHeader = (dst, body) => {
  if (/nature:\s*(type-only|runtime-bearing)/i.test(body)) return body;
  const sf = ts.createSourceFile(dst, body, ts.ScriptTarget.Latest, false,
    /\.jsx$/.test(dst) ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
  const nature = sf.statements.length === 0 ? 'type-only' : 'runtime-bearing';
  return `// fixture: categories/${dst}\n// nature: ${nature}\n` + body;
};
for (const [dst, body] of Object.entries(ADDITIONS)) want.set(dst, Buffer.from(withHeader(dst, body), 'utf8'));
for (const [dst, cfg] of Object.entries(CONFIGS)) want.set(dst, Buffer.from(JSON.stringify(cfg, null, 2) + '\n', 'utf8'));
// package.json files that staging itself ships and that must travel unchanged
for (const f of walk(STAGING).filter((f) => f.endsWith('package.json'))) {
  const rule = RULES.find(([re]) => re.test(f));
  if (!rule) continue;
  const dst = rule[1](f);
  if (!CONFIGS[dst]) want.set(dst, fs.readFileSync(path.join(STAGING, f)));
}

if (CHECK) {
  // PROVENANCE.json and COVERAGE.md are GENERATED beside the tree, not promoted
  // from staging, so they are not drift.
  const GENERATED = new Set(['PROVENANCE.json', 'COVERAGE.md']);
  const have = fs.existsSync(CATEGORIES)
    ? new Set(walk(CATEGORIES).filter((f) => !GENERATED.has(f))) : new Set();
  let drift = 0;
  for (const [dst, body] of want) {
    const p = path.join(CATEGORIES, dst);
    if (!fs.existsSync(p)) { console.log(`MISSING  ${dst}`); drift++; continue; }
    if (sha(fs.readFileSync(p)) !== sha(body)) { console.log(`CHANGED  ${dst}`); drift++; }
    have.delete(dst);
  }
  for (const extra of have) { console.log(`EXTRA    ${extra}`); drift++; }
  console.log(drift === 0 ? `in sync: ${want.size} files` : `${drift} file(s) drifted from staging`);
  process.exit(drift === 0 ? 0 : 1);
}

if (fs.existsSync(CATEGORIES)) fs.rmSync(CATEGORIES, { recursive: true });
for (const [dst, body] of want) {
  const p = path.join(CATEGORIES, dst);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
const manifest = mapping.map(([src, dst]) => ({ from: `staging/${src}`, to: `categories/${dst}`, sha256_16: sha(want.get(dst)) }))
  .concat(Object.keys(ADDITIONS).map((dst) => ({ from: 'ADDED by js-corpus (enum coverage gap)', to: `categories/${dst}`, sha256_16: sha(want.get(dst)) })))
  .concat(Object.keys(CONFIGS).map((dst) => ({ from: 'MINTED by the promotion (category layout)', to: `categories/${dst}`, sha256_16: sha(want.get(dst)) })));
fs.writeFileSync(path.join(CATEGORIES, 'PROVENANCE.json'), JSON.stringify({
  generatedBy: 'tools/javascript/promote-fixtures.mjs',
  stagingFiles: sources.length, categoryFiles: want.size, mapping: manifest,
}, null, 1) + '\n');
console.log(`promoted ${mapping.length} fixtures + ${Object.keys(ADDITIONS).length} addition(s) `
  + `+ ${Object.keys(CONFIGS).length} minted config(s) -> ${want.size} files`);
