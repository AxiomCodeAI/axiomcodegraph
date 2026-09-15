import { createRequire } from 'node:module';
import Square, { Circle, Shape, util, compare, bump, counter } from './lib/shapes.js';
import * as barrel from './lib/barrel.js';
import def, { Square as SquareAlias, helpers, shapes } from './lib/barrel.js';
import { Bus, onDone } from './lib/bus.js';
import { pipeline, ready } from './lib/asyncy.js';
import makePlugin, { anon as Anon } from './lib/plugin.js';
import interop from './lib/interop.cjs';
const require = createRequire(import.meta.url);
const viaRequire = require('./lib/interop.cjs');

function classes() {
  const c = new Circle(2); c.describe(); c.area();
  const s = new Square('sq'); s.describe(); Square.create('x').describe();
  Shape.create('base').describe();
  [c, s].sort(compare).map((x) => x.area());
  c.subscribe(util.twice).subscribe((v) => util.inc(v)).notify(3);
  bump(); bump(); if (counter !== 2) throw new Error('live binding');
}
function reexports() {
  new barrel.Circle(1).area(); barrel.Shape.create('b').describe(); new barrel.Square('q').describe();
  barrel.helpers.inc(1); barrel.shapes.util.twice(2); new barrel.shapes.Circle(1).describe(); barrel.default.create('d').describe();
  new SquareAlias('a').area(); helpers.twice(3); shapes.compare(new Circle(1), new Circle(2)); def.create('e').area();
}
function events() { const b = new Bus(); b.on('done', onDone); b.start(); }
async function asyncs() { await pipeline(); ready.describe(); }
function plugins() { const p = makePlugin('p'); p.run().describe(); p.base().describe(); new Anon('an').own(); }
function cjs() { interop.fromCjs(); new interop.CjsThing().run(); interop.later(); viaRequire.fromCjs(); }
async function main() { classes(); reexports(); events(); await asyncs(); plugins(); cjs(); }
await main();
