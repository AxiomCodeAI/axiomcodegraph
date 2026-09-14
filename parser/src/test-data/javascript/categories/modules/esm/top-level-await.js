// fixture: esm/top-level-await.js
// module system: ESM  (governing: staging/esm/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2022 (top-level await) — ABOVE THE BASELINE. Quarantined in
//   its own file so the whole fixture can be dropped if the agreed floor lands
//   below ES2022, without touching anything else.
//
// js_module.hasTopLevelAwait exists because top-level await FORCES module
// semantics: a file containing it cannot be CommonJS, cannot be a script, and
// its evaluation is asynchronous — importers wait for it. That is a property of
// the module and not of any statement in it, which is why it is a module column.
//
// The scope consequence is the interesting one: the module's top-level scope is
// now an async context, so `await` is legal in every position at depth 0 of the
// module scope but still illegal inside a non-async nested function.

import { readFile } from 'node:fs/promises';

// Awaited at module top level. The module's evaluation suspends here.
const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

// Awaited dynamic import at top level: a module edge, a call site and a
// suspension point in one expression.
const { normalize } = await import('./imports/pkg/util.js');

// Await in a loop, at top level.
const versions = [];
for (const dep of Object.keys(pkg.dependencies || {})) {
  versions.push(await Promise.resolve(dep));
}

// Await in a conditional initializer at top level.
const maybe = pkg.type === 'module' ? await Promise.resolve('esm') : 'cjs';

// Await inside a try at top level.
let optional = null;
try {
  optional = await import('ansi-paint');
} catch {
  optional = null;
}

// NOT awaited: a nested non-async function cannot use await, and `await` there
// is an ordinary identifier in sloppy code — though not here, because ESM is
// always strict.
function sync() {
  return normalize('  x  ');
}

export { pkg, normalize, versions, maybe, optional, sync };
