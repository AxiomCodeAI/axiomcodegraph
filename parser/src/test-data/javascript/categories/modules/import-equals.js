// fixture: categories/modules/import-equals.js
// nature: runtime-bearing
// JsImportForm.IMPORT_EQUALS — declared, emittable, and covered by nothing else.
//
// `import x = require('y')` is TypeScript syntax and NOT JavaScript: Node throws
// on it. `ts.createSourceFile` under ScriptKind.JS parses it with ZERO
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
