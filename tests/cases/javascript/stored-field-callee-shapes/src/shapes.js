'use strict';
const debug = require('debug');
function alpha() { return 'a'; }
class FieldNull {
  cb = null;
  set(f) { this.cb = f; }
  run() { return this.cb(); }
}
class CtorNull {
  constructor() { this.cb = null; }
  set(f) { this.cb = f; }
  run() { return this.cb(); }
}
class Fallback {
  constructor(cb) { this.cb = cb || function () {}; }
  run() { return this.cb(); }
}
class Static {
  static set(f) { this.cb = f; }
  static run() { return this.cb(); }
}
class StaticField {
  static cb = null;
  static run() { return this.cb(); }
}
class Alias {
  constructor(cb) { this.cb = cb; }
  run() { const self = this; return self.cb(); }
}
class Maker {
  constructor(C) { this.Ctor = C; }
  make() { return new this.Ctor(); }
}
const log = debug('app');
function logs() { log('x'); return 1; }
const tag = require('util').format;
function tags() { return tag('%s', 'x'); }
const wrapped = debug(alpha);
function callsWrapped() { return wrapped(); }
// controls: none of these is a value callee
const EventEmitter = require('events');
class Bus extends EventEmitter { go() { return this.emit('x'); } }
class Own { own() { return 1; } run() { return this.own(); } }
class Known { constructor() { this.fn = alpha; } run() { return this.fn(); } }
class Fixed { constructor(cb) { this.cb = alpha || cb; } }
function useOwn() { const o = new Own(); return o.run(); }
module.exports = { alpha, FieldNull, CtorNull, Fallback, Static, StaticField, Alias, Maker, logs, tags, callsWrapped, Bus, Known, Fixed, useOwn };
