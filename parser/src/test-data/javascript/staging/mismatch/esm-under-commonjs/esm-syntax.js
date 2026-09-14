// fixture: mismatch/esm-under-commonjs/esm-syntax.js
// module system: ESM SYNTAX under a declared CommonJS config
//   governing: staging/mismatch/esm-under-commonjs/package.json, "type": "commonjs"
// nature: runtime-bearing — but this program CANNOT RUN on Node as configured.
//   `node esm-syntax.js` fails with ERR_REQUIRE_ESM / "Cannot use import
//   statement outside a module". ts.createSourceFile parses it happily, which is
//   exactly the trap: the parse succeeds and the program does not exist.
// syntax floor: ES2015 (import/export)
//
// contradictsGoverningConfig = true, contradictionKind = ESM_SYNTAX_UNDER_COMMONJS.
// Measured at 6.2% of real files, all in this direction, all bundler input — a
// bundler entry point whose package never declared "type": "module"
// because the bundler, not Node, is what reads it.
//
// The Q3 ruling is emit-normally-and-flag, never a SkippedFileReason. This
// fixture is what makes that ruling checkable: the ESM facts must be present AND
// the flag must be set. Emitting the facts without the flag says a program runs
// that does not; skipping the file loses a file real repositories are full of.

import { readFile } from 'node:fs/promises';
import defaultExport, { named as renamed } from '../../cjs/commonjs/module-exports-assignment.js';
import * as ns from '../../cjs/commonjs/exports-shorthand.js';
import '../../cjs/commonjs/circular-b.js';

export const VERSION = '1.0.0';

export function load(file) {
  return readFile(file, 'utf8');
}

export default class Entry {
  constructor(name) {
    this.name = name;
  }
}

export { renamed, ns };
