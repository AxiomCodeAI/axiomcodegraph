'use strict';
// ── events: EventEmitter subclass, on/once/emit, computed names, a hand-rolled dispatcher ──
const EventEmitter = require('events');
class Bus extends EventEmitter {
  constructor() { super(); this.handlers = {}; this.hooks = []; }
  start() { this.emit('start', 1); this.emit('tick', 2); return this; }
  fire(name) { this.emit(name, 3); }
  hook(fn) { this.hooks.push(fn); return this; }
  runHooks(v) { return this.hooks.map((h) => h(v)); }
  register(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); }
  dispatch(name, v) { const hs = this.handlers[name] || []; return hs.map((h) => h.call(this, v)); }
}
function onStart(v) { return v; }
function onTick(v) { return v * 2; }
function onAny(v) { return v + 1; }
function hookA(v) { return v + 'a'; }
function hookB(v) { return v + 'b'; }
function handlerX(v) { return this.hooks.length + v; }
module.exports = { Bus, onStart, onTick, onAny, hookA, hookB, handlerX };
