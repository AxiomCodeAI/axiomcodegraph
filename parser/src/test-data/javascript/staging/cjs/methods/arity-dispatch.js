// fixture: cjs/methods/arity-dispatch.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// Port of java/methods/MethodOverloadPatterns.java, and the port is a NEGATIVE
// one worth spelling out.
//
// NO ANALOGUE — overloading. JavaScript has no overload sets: a second
// declaration of the same name REPLACES the first, and there is exactly one
// callable per name at any moment. There is no signature-based dispatch, no
// arity-based dispatch and no resolution step at a call site.
//
// What real code does instead is inspect its own arguments at runtime, which
// moves the dispatch INTO THE BODY and out of the call graph entirely. That is
// the shape a Java-derived model cannot express: one js_method with N behaviours
// and N call sites that all resolve to it, where the interesting question —
// which behaviour ran — has no static answer.
//
// The JSDoc @overload tag claims otherwise, and it is a comment
// (jsdoc/satisfies-and-unknown-syntax.js has it).
//
// Grounded in a DOM selector library's `select()`, a utility library's `get`, a web framework's `app.listen` and
// `res.send`, and node's `fs.readFile`.

'use strict';

// --- redefinition, not overloading -------------------------------------------------
//
// Two declarations, one name. The second wins from the moment the scope is
// entered, because both hoist. Anything that calls `redefined` calls the second
// one, always.

function redefined(a) { return 'one arg'; }
function redefined(a, b) { return 'two args'; }

// --- dispatch by arity ------------------------------------------------------------------
//
// A web framework's `app.listen` and the platform's `fs.readFile` both do this: the LAST
// argument is the callback if it is a function, and everything before it shifts.

function readFile(pathname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = { encoding: 'utf8' };
  }
  return callback(null, pathname + ':' + options.encoding);
}

function listen(...args) {
  switch (args.length) {
    case 0: return 'default port';
    case 1: return typeof args[0] === 'function' ? 'callback only' : 'port only';
    case 2: return 'port and callback';
    default: return 'port, host and callback';
  }
}

// --- dispatch by type -----------------------------------------------------------------------
//
// The DOM selector library's `select()` is the canonical case: the same name accepts a selector, an
// element, a function, an array or another wrapped collection, and does something
// different with each.

function select(subject) {
  if (typeof subject === 'string') { return { kind: 'selector', subject }; }
  if (typeof subject === 'function') { return { kind: 'ready', subject }; }
  if (Array.isArray(subject)) { return { kind: 'collection', subject }; }
  if (subject instanceof Date) { return { kind: 'date', subject }; }
  if (subject && typeof subject.nodeType === 'number') { return { kind: 'element' }; }
  if (subject == null) { return { kind: 'empty' }; }
  return { kind: 'object', subject };
}

// --- dispatch by an options object ------------------------------------------------------------
//
// The modern replacement. One signature, and the "overload" is which keys are
// present — so the branches are decided by data that may come from anywhere.

function request({ url, method = 'GET', body = null, json = false, ...rest } = {}) {
  if (json && body) { return { url, method, body: JSON.stringify(body), rest }; }
  if (body) { return { url, method, body, rest }; }
  return { url, method, rest };
}

// --- dispatch by argument SHAPE ---------------------------------------------------------------
//
// A utility library's `get(object, path)` accepts a string path, an array path, or a
// number, and normalises them all.

function get(object, path, defaultValue) {
  const parts = Array.isArray(path)
    ? path
    : String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current = object;
  for (const part of parts) {
    if (current == null) { return defaultValue; }
    current = current[part];
  }
  return current === undefined ? defaultValue : current;
}

// --- a class method doing the same thing --------------------------------------------------------

class Response {
  constructor() { this.body = null; this.status = 200; }

  // A web framework's res.send: chunk may be a status code, a string, a Buffer, an
  // object or nothing, and there is one method.
  send(chunk) {
    if (typeof chunk === 'number' && arguments.length === 1) {
      this.status = chunk;
      return this;
    }
    if (Buffer.isBuffer(chunk)) { this.body = chunk; return this; }
    if (typeof chunk === 'object' && chunk !== null) { return this.json(chunk); }
    this.body = chunk === undefined ? '' : String(chunk);
    return this;
  }

  json(value) { this.body = JSON.stringify(value); return this; }

  // Two names for one implementation — the reverse of overloading. Both names
  // are call targets and both resolve to the same js_method row.
  end(chunk) { return this.send(chunk); }
}
Response.prototype.write = Response.prototype.send;

// --- the call sites -------------------------------------------------------------------------------
//
// Every one of these resolves to exactly one declaration, and which branch runs
// is not decidable from the call site. That is the property to preserve: the
// call graph is right and it is not enough.

const calls = [
  redefined(1),
  redefined(1, 2),
  readFile('/a', (e, d) => d),
  readFile('/a', { encoding: 'ascii' }, (e, d) => d),
  listen(),
  listen(3000),
  listen(3000, () => {}),
  select('div'),
  select(() => {}),
  select([1, 2]),
  select(new Date()),
  select(null),
  request({ url: '/a' }),
  request({ url: '/a', body: { x: 1 }, json: true }),
  get({ a: { b: [1] } }, 'a.b[0]'),
  get({ a: { b: [1] } }, ['a', 'b', 0]),
  new Response().send(404),
  new Response().send('text'),
  new Response().send({ a: 1 })
];

module.exports = { redefined, readFile, listen, select, request, get, Response, calls };
