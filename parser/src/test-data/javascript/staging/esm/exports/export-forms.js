// fixture: esm/exports/export-forms.js
// module system: ESM  (governing: staging/esm/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2015, except the string-named export at the bottom (ES2022)
//
// Every declaration-borne export form, as the counterpart to imports/import-forms.js.
// exportForm = EXPORT_DECLARATION / EXPORT_DEFAULT / EXPORT_ALL; edgeBearer =
// DECLARATION throughout, which is the partition that CommonJS inverts.
//
// The two properties CommonJS does not have, and that a ported CJS model cannot
// express, are both here: ESM exports are LIVE BINDINGS (mutating the local
// updates the importer's view, which `module.exports.x = 1` does not), and they
// are STATIC (the set of names is fixed at parse time, which is what makes
// `export *` analysable and `Object.assign(exports, ...)` not).

// Exported declarations.
export const NAME = 'export-forms';
export let counter = 0;
export var legacy = null;
export function bump() { counter += 1; return counter; }
export async function bumpLater() { return bump(); }
export function* bumps() { while (true) { yield bump(); } }
export class Counter {
  constructor() { this._value = 0; }
  increment() { return ++this._value; }
  get value() { return this._value; }
  set value(v) { this._value = v; }
}

// Export lists, with and without renaming. A name may be exported twice under
// two names, which means exportedName is not a key on its own.
const internal = Symbol('internal');
function helper() { return internal; }
export { helper, helper as alsoHelper, internal as internalSymbol };

// Default export of an expression rather than a declaration. There is no local
// binding named `default`, and exportedName is `default` all the same.
export default {
  NAME,
  bump
};

// A string-named export. Legal since ES2022; the name is not an identifier, so
// it is only reachable by `import { "not-an-identifier" as x }`. Kept here
// rather than quarantined because it is export SYNTAX at the ES2022 line, not a
// class-body feature — see MANIFEST.md's syntax-floor table.
const weird = 1;
export { weird as 'not-an-identifier' };
