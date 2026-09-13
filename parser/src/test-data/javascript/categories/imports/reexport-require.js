// fixture: cjs/commonjs/reexport-require.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// `module.exports = require('./y')` — one statement that is simultaneously an
// import edge and an export edge, 81 sites in the schema's corpus. isReExport
// and reExportSpecifier exist for exactly this row, and the js_export must
// point at the js_import it re-exports rather than duplicating the specifier.
//
// Grounded in a web framework's router (`module.exports = Plugin`), a utility library's
// per-method files, and the countless `index.js` files whose entire content is
// a re-export.

'use strict';

// A member of a re-export. The import edge is `./module-exports-members`; the
// export edge is that module's `Segment`, under a different name.
module.exports = require('./module-exports-members').Segment;

// Named members re-exported one at a time. Each line is an import edge AND an
// export edge, and the two specifiers differ.
module.exports.methods = {
  get: require('./module-exports-members').digest,
  post: require('./exports-shorthand').stringify
};

// A re-export of a builtin. The re-exported module is not in this project, so
// the import's resolutionOutcome is RESOLVED_BUILTIN and following the edge
// leaves the project entirely.
module.exports.pathModule = require('path');

// Re-export spread into an object literal. Every enumerable own property of the
// required module becomes an export of this one, and syntax cannot name them —
// the names live in the other file.
module.exports.all = Object.assign({}, require('./exports-shorthand'));

// The unresolvable re-export: specifier is not a literal, so this exports
// something the parser cannot name from something it cannot resolve.
module.exports.plugin = require(process.env.FIXTURE_PLUGIN || './exports-array');
