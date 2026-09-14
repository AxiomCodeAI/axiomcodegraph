// fixture: esm/import-meta.js
// module system: ESM  (governing: staging/esm/package.json, "type": "module")
// nature: runtime-bearing
// syntax floor: ES2020 (import.meta); import.meta.resolve needs Node >= 20.6
//
// import.meta is a MetaProperty, not a member access on an object called
// `import` — `import` is a keyword and cannot be a receiver. It exists only in
// an ES module, which makes any reference to it evidence of the module system
// in the same way `__dirname` is evidence of the other one.
//
// import.meta.resolve is a resolver call. It answers the same question
// ts.resolveModuleName answers and it is Node's answer rather than tsc's model
// of Node's answer, which is why the schema puts resolver disagreement in the
// oracle rather than in js_import.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const url = import.meta.url;
const dirname = path.dirname(fileURLToPath(import.meta.url));

// A call whose receiver is a MetaProperty. The receiver text is `import.meta`
// and it names no binding anywhere.
const resolvedSelf = import.meta.resolve('./import-meta.js');
const resolvedBare = import.meta.resolve('node:fs');

// A property of import.meta that may or may not exist depending on the host.
// Bundlers add their own (import.meta.hot, import.meta.env); Node does not.
const hot = import.meta.hot;

export { url, dirname, resolvedSelf, resolvedBare, hot };
