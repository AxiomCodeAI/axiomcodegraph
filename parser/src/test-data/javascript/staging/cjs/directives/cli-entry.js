#!/usr/bin/env node
// fixture: cjs/directives/cli-entry.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// A shebang. commentKind = SHEBANG, and it is the one comment form whose
// POSITION is load-bearing: it is legal only as the first two bytes of a file,
// it is not a comment to any other tool, and `ts.createSourceFile` gives it its
// own trivia kind rather than folding it into a line comment.
//
// Every CLI entry point published to npm has one —
// and it is the reason `bin` scripts cannot begin with a blank line. Until now
// no fixture had one, so SHEBANG carried zero rows and was indistinguishable
// from an unimplemented value.

'use strict';

const path = require('path');

function main(argv) {
  const [, , command = 'help'] = argv;
  switch (command) {
    case 'run': return 0;
    case 'help': return 1;
    default: return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { main, binName: path.basename(__filename) };
