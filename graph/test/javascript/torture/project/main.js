'use strict';
const { Shape, Circle, Square, Tagged } = require('./lib/shapes');
const legacy = require('./lib/legacy');
const F = require('./lib/functional');
const { Bus, onStart, onTick, onAny, hookA, hookB, handlerX } = require('./lib/bus');
const asyncy = require('./lib/asyncy');
const reg = require('./lib/registry');
const makePlugin = require('./plugins');
const streams = require('./lib/streams');
const io = require('./lib/io');
const direct = require('./lib/direct');

function classes() {
  const c = new Circle(2);
  c.describe(); c.area(); c.label; c.label = 'x';
  const s = Shape.create('base'); s.describe();
  const sq = Square.create('sq'); sq.describe();
  const t = new Tagged('t'); t.reveal(); t.describe();
  [c, sq].sort(Shape.compare).map((x) => x.area());
  c.clone().describe();
  c.subscribe((v) => F.inc(v)).subscribe(F.twice).notify(3);
  c.onChange(4);
  return c;
}
function legacies() {
  const d = new legacy.Dog('rex'); d.speak(); d.shout();
  const cat = new legacy.Cat('tom'); cat.speak();
  legacy.Animal.make('generic').speak();
  const k = new legacy.Kennel();
  k.on('added', function onAdded(dog) { return dog.sound(); });
  k.add(d).add(cat); k.roll();
  return k;
}
function functional() {
  F.incTwice(1); F.addOne(2); F.fact(4); F.fib(5);
  F.counter.bump(); F.counter.reset();
  F.withDefault(); F.withDefault(() => 5, { mapper: F.inc, tag: true });
  F.variadic(F.inc, F.twice, (x) => F.add(x, 1));
  F.applyAll([F.inc, F.twice], 1);
  F.pipeline([F.fact]); F.nested([F.fib]);
  F.slowSquare(3); F.slowSquare(3);
  const bound = F.add.bind(null, 10); bound(1);
  F.add.call(null, 1, 2); F.add.apply(null, [1, 2]);
}
function events() {
  const b = new Bus();
  b.on('start', onStart).once('tick', onTick).on(process.env.NOPE || 'dyn', onAny);
  b.start(); b.fire('dyn');
  b.hook(hookA).hook(hookB).runHooks('v');
  b.register('x', handlerX); b.dispatch('x', 1);
  return b;
}
async function asyncs() {
  await asyncy.pipeline(1);
  await io.readAll();
  asyncy.later(F.inc);
  asyncy.withCallback(1, (err, v) => F.twice(v));
  await asyncy.withCallbackP(2);
}
function dynamics() {
  reg.byName('update', 1); reg.byBracket(2); reg.viaProxy(3); reg.viaReflect(4); reg.viaArguments(5, 6); reg.tagged(7);
}
function modules() {
  const p = makePlugin('p'); p.run(); makePlugin.shapes.Circle.create('z'); makePlugin.functional.twice(2); makePlugin.late(); if (typeof makePlugin.orphan === 'function') throw new Error('orphan must not be exported');
}
async function directs() { await direct.registers(); direct.direct(); direct.keep(); direct.callStored(); }
async function streamed() { await streams.drive(); await streams.pump(); }
async function main() {
  classes(); legacies(); functional(); events(); await asyncs(); await streamed(); await directs(); dynamics(); modules();
  (function iife() { F.inc(9); })();
  (() => F.twice(9))();
}
main();
