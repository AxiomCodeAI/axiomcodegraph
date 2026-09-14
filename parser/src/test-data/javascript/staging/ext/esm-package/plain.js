// fixture: ext/esm-package/plain.js
// module system: ESM  (governing: staging/ext/esm-package/package.json, "type": "module")
//   moduleSystemSource = PKG_TYPE_MODULE. Nothing in this FILE says which system
//   it is; the answer is entirely in a file it does not contain.
// nature: runtime-bearing
// syntax floor: ES2015
//
// The control for override.cjs. Identical extension to every CommonJS fixture in
// this corpus, opposite module system.

import { EOL } from 'node:os';

export function split(text) {
  return String(text).split(EOL);
}

export const moduleSystem = 'esm-by-package-type';
