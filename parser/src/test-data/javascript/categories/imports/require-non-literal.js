// fixture: cjs/commonjs/require-non-literal.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 (template literal)
//
// The fixture exists to prove the parser SAYS a specifier is unresolvable rather
// than guessing one. Every require below has a specifier that syntax does not
// fix, so the honest row is specifierKind = NON_LITERAL (or TEMPLATE),
// resolvedFilePath = "", resolutionOutcome = UNRESOLVED_NON_LITERAL — plus a
// js_parse_gap with gapKind = NON_LITERAL_SPECIFIER.
//
// A parser that resolves `require(name)` by picking the first candidate it can
// find is wrong in the direction that invents module edges, which is worse than
// emitting none. Grounded in the plugin-loader pattern every test runner, build
// tool and lint-config resolver uses.

'use strict';

const path = require('path');

// 1. A plain identifier. The value is a parameter — not knowable at parse time.
function loadPlugin(name) {
  return require(name);
}

// 2. A template literal with a substitution. The prefix is fixed, the rest is not.
function loadReporter(reporter) {
  return require(`./reporters/${reporter}`);
}

// 3. String concatenation — the pre-template-literal spelling of the same thing.
function loadRule(ruleId) {
  return require('./rules/' + ruleId);
}

// 4. A computed path. Two calls deep and definitively not a literal.
function loadFromDir(dir, file) {
  return require(path.join(dir, file));
}

// 5. A member expression as the specifier.
const config = { adapter: './adapters/memory' };
const adapter = require(config.adapter);

// 6. A conditional. Two literal specifiers, but the expression is not a literal.
//    Both branches are real module edges; the row cannot name just one of them.
const impl = require(process.env.FIXTURE_FAST ? './fast-impl' : './slow-impl');

// 7. A template literal with NO substitution. This one IS a literal — it has a
//    single fixed value — and it is here as the control. A parser that treats
//    every TemplateExpression as unresolvable gets this wrong in the other
//    direction, and without the control nothing would catch that.
const literalTemplate = require(`./module-exports-assignment`);

// 8. require aliased to another name, then called. The callee is not the
//    identifier `require`, so a syntactic matcher keyed on the callee name
//    misses it entirely.
const req = require;
const aliased = req('./exports-shorthand');

// 9. Indirect through a member. `module.require` is a real API.
const viaModule = module.require('./module-exports-members');

module.exports = {
  loadPlugin,
  loadReporter,
  loadRule,
  loadFromDir,
  adapter,
  impl,
  literalTemplate,
  aliased,
  viaModule
};
