'use strict';
// ── generators, async iteration, promise combinators, platform callbacks, EventEmitter idioms ──
const EventEmitter = require('events');
class Widget { run() { return 'w'; } }
function* gen() { yield new Widget(); yield new Widget(); }
function* delegating() { yield* gen(); }
async function* agen() { yield new Widget(); }
function generators() {
  for (const w of gen()) w.run();
  for (const w of delegating()) w.run();
  const it = gen(); it.next().value.run();
  [...gen()].forEach((w) => w.run());
  Array.from(gen()).map((w) => w.run());
  return 0;
}
async function asyncIter() { for await (const w of agen()) w.run(); }
async function get() { return new Widget(); }
function getP() { return Promise.resolve(new Widget()); }
function getNewP() { return new Promise((resolve) => resolve(new Widget())); }
async function promises() {
  (await get()).run();
  (await getP()).run();
  (await getNewP()).run();
  get().then((w) => w.run());
  getP().then((w) => w.run());
  getNewP().then((w) => w.run());
  const [a, b] = await Promise.all([get(), getP()]); a.run(); b.run();
  Promise.all([get()]).then(([w]) => w.run());
  const c = await Promise.race([get()]); c.run();
  const s = await Promise.allSettled([get()]); s.length;
  await get().then((w) => w).then((w) => w.run());
  get().then(null, (e) => onError(e)).catch(onError).finally(onDone);
  await new Promise((resolve, reject) => { setTimeout(resolve, 1); }).then(onDone);
  return 0;
}
function onError(e) { return e; }
function onDone() { return 1; }
function h1() { return 1; }
function h2() { return 2; }
function platformCallbacks() {
  [1, 2].filter(h1).some(h1).valueOf(); [1].every(h1); [1].findIndex(h1); [1].flatMap(h2); [3, 1].sort((a, b) => a - b);
  [1].reduce((acc, x) => acc + h1(), 0); [1].reduceRight(h2, 0);
  Array.from({ length: 2 }, h1); Array.from([1], h2);
  'abc'.replace(/a/g, h1); 'abc'.replaceAll('a', h2);
  JSON.parse('{"a":1}', h1); JSON.stringify({ a: 1 }, h2);
  Object.keys({ a: 1 }).forEach(h1); Object.entries({ a: h1 }).forEach(([k, v]) => v());
  new Map([['a', 1]]).forEach(h1); new Set([1]).forEach(h2);
  const t = setInterval(h1, 1); clearInterval(t); setImmediate(h2); queueMicrotask(h1); process.nextTick(h2);
  new Promise((res) => res(1)).then(h1);
  return 0;
}
class Emitter extends EventEmitter {
  constructor() {
    super();
    this.on('a', this.onA);
    this.on('b', this.onB.bind(this));
    this.on('c', (...args) => this.onC(...args));
    this.once('d', function () { return this.onA(); });
    this.addListener('e', onDone); this.prependListener('e', onError);
    this.on('error', onError);
  }
  onA() { return 'a'; }
  onB() { return 'b'; }
  onC() { return 'c'; }
  fire() { this.emit('a'); this.emit('b'); this.emit('c', 1); this.emit('d'); this.emit('e'); return this; }
  fireDynamic(n) { this.emit(n); }
}
function externalRegistration() {
  const e = new Emitter();
  e.on('x', h1); e.once('x', h2); e.emit('x');
  const em2 = new EventEmitter(); em2.on('y', h1); em2.emit('y');
  process.on('beforeExit', onDone);
  return e;
}
module.exports = { Widget, generators, asyncIter, promises, platformCallbacks, Emitter, externalRegistration, get, getP, getNewP };
