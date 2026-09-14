// fixture: cjs/commonjs/destructured-require.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018 (object rest in a destructuring pattern)
//
// One require, N bound names, one line. This is the shape that made startColumn
// part of the js_import primary key: `const {a, b} = require('x')` is two import
// rows with the same ownerModule, the same specifier and the same startLine, and
// without a column they collide by DOUBLING rather than by erroring.
//
// Grounded in a runtime's internal modules, which open nearly every file with
// `const { ObjectKeys, StringPrototypeSlice } = primordials;` and with
// destructured requires of internal/errors.

'use strict';

// The canonical two-name form.
const { readFile, writeFile } = require('fs');

// Renamed while destructured: importedName and localName differ, and neither is
// the specifier. Three rows on one line.
const { promisify: toPromise, inherits: extend, format } = require('util');

// Nested destructuring. `constants.errno.ENOENT` binds one name from two levels
// down; the path to it is not recoverable from the local name alone.
const { constants: { errno: { ENOENT } } } = require('os');

// Default value in the pattern. The name is bound whether or not the module
// exports it, which means the binding exists even when the import edge is
// unsatisfiable.
const { createHash, createHmac = null } = require('crypto');

// Rest element. `rest` binds every OTHER export, and syntax cannot say what
// those are — the names are a property of the required module, not of this file.
const { join, ...restOfPath } = require('path');

// Array destructuring of a require. Rare but legal, and it binds by position
// rather than by name, which is a different importedName story again.
const [first, second] = require('./exports-array');

// Destructuring a member of a require. The specifier is the module; the
// destructuring applies to one of its properties.
const { get, post } = require('./reexport-require').methods;

// Two requires, two patterns, one statement. A per-statement extractor that
// assumes one specifier per VariableStatement loses the second.
const { EventEmitter } = require('events'), { Readable } = require('stream');

// let, not const. The binding is reassignable, so the module alias is not
// stable — isReassigned on the variable is the column that says so.
let { deepEqual } = require('assert');
deepEqual = null;

module.exports = {
  readFile, writeFile, toPromise, extend, format, ENOENT,
  createHash, createHmac, join, restOfPath, first, second,
  get, post, EventEmitter, Readable, deepEqual
};
