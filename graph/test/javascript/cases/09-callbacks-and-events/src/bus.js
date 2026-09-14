'use strict';
const EventEmitter = require('events');
class Bus extends EventEmitter {
  start() { this.emit('ready', 1); this.emit('data', 2); }
  stop() { const name = this.current; this.emit(name); }
}
function onReady(n) { return n; }
function onData(n) { return n * 2; }
function onAnything() { return 0; }
const bus = new Bus();
bus.on('ready', onReady);
bus.once('data', onData);
bus.on(process.env.EVT, onAnything);
bus.start();
bus.stop();
const other = new Bus();
other.on('ready', function otherReady() { return 9; });
function schedule(cb) { setTimeout(cb, 10); Promise.resolve().then(cb, (e) => onAnything(e)); }
schedule(() => bus.start());
[bus, other].forEach((b) => b.stop());
module.exports = { Bus, bus };
