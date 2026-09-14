// fixture: categories/imports/esm/import-binding-alias.js
// nature: runtime-bearing
// JsInitializerKind.IMPORT_BINDING — declared, and the CommonJS twin emits 12,345 times.
//
// `REQUIRE_CALL` is documented as "the name is a module alias" and is emitted for
// `const x = require('y')`. `IMPORT_BINDING` is documented as "a name bound by an
// import declaration. Also a module alias, by the other route" and is emitted
// never. Both spellings alias a module binding; an engine that can see one and
// not the other sees half the module graph's aliases.
//
// Two readings are covered here because the schema does not say which is meant,
// and both currently produce something other than IMPORT_BINDING:
//   (a) the variable minted FOR the import binding itself  -> initializerKind NONE
//   (b) a local initialised FROM an import binding          -> initializerKind OTHER
//
// module system: ESM, governed by imports/esm/package.json ("type": "module").
import { readFile } from 'node:fs';
import defaultExport from './pkg/util.js';
import * as namespaceBinding from './pkg/util.js';

// (b) — a local whose initializer IS an import binding.
const aliasOfNamed = readFile;
const aliasOfDefault = defaultExport;
const aliasOfNamespace = namespaceBinding;

// The control, in the same file: a local initialised from something that is not
// a module binding at all.
const notAnAlias = { readFile };

export { aliasOfNamed, aliasOfDefault, aliasOfNamespace, notAnAlias };
