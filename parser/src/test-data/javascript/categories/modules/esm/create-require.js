// fixture: esm/create-require.js
// module system: ESM  (governing: staging/esm/package.json, "type": "module")
// nature: runtime-bearing — and unlike require-under-esm.js, this one RUNS.
// syntax floor: ES2020 (import.meta)
//
// module.createRequire is the sanctioned way an ES module reaches a CommonJS
// one, and it is how every ESM package that must read its own package.json is
// written. importForm = CREATE_REQUIRE is a distinct value from REQUIRE_CALL
// because the callee is a local binding produced by a factory: a matcher keyed
// on the identifier `require` finds nothing here, and a matcher keyed on
// "any call named require" finds the wrong things elsewhere.
//
// Grounded in the documented createRequire idiom every ESM package uses to read its own package.json.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);

// The alias is not called `require` here, which is the case that breaks
// name-based matching.
const requireFromCwd = createRequire(path.join(process.cwd(), 'noop.js'));

const pkg = require('../cjs/package.json');
const legacy = require('../cjs/commonjs/module-exports-assignment.js');
const sibling = requireFromCwd('./imports/pkg/index.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function version() {
  return pkg.version;
}

export { legacy, sibling, __dirname, __filename };
