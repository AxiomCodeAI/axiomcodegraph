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
const { promisify } = require('util');
class Store { find(e) { return e; } }
class Svc { constructor(s) { this.find = promisify(s.find.bind(s)); } login(e) { return this.find(e); } }
const findAsync = promisify(new Store().find.bind(new Store()));
function viaModule(e) { return findAsync(e); }
class Auth { constructor(s) { this.find = promisify(s.find.bind(s)); } login(e) { return this.find(e); } }
function makeAuth() { return new Auth(new Store()); }
class Clock { constructor() { this.wait = promisify(setTimeout); } tick() { return this.wait(1); } }
class Reader { constructor() { this.read = promisify(Math.max.bind(Math)); } go() { return this.read(1); } }
// controls: none of these is a value callee
const EventEmitter = require('events');
class Bus extends EventEmitter { go() { return this.emit('x'); } }
class Own { own() { return 1; } run() { return this.own(); } }
class Known { constructor() { this.fn = alpha; } run() { return this.fn(); } }
class Fixed { constructor(cb) { this.cb = alpha || cb; } }
function useOwn() { const o = new Own(); return o.run(); }
module.exports = { alpha, FieldNull, CtorNull, Fallback, Static, StaticField, Alias, Maker, logs, tags, callsWrapped, Bus, Known, Fixed, useOwn, Store, Svc, viaModule, Auth, makeAuth, Clock, Reader };
