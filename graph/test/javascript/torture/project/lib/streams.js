'use strict';
// #611: a class extending a platform stream base has hook methods only the platform calls,
// when project code calls write() / end() / resume() on an instance.
const { Writable, Readable, Transform } = require('stream');
const F = require('./functional');
class Sink extends Writable {
  constructor() { super({ objectMode: true }); this.total = 0; }
  _write(chunk, enc, cb) { this.total = F.add(this.total, chunk); cb(); }
  _final(cb) { F.inc(this.total); cb(); }
}
class Source extends Readable {
  constructor() { super({ objectMode: true }); this.left = 2; }
  _read() { this.push(this.left > 0 ? F.twice(this.left--) : null); }
}
class Doubler extends Transform {
  constructor() { super({ objectMode: true }); }
  _transform(chunk, enc, cb) { cb(null, F.twice(chunk)); }
  _flush(cb) { F.inc(0); cb(); }
}
function drive() {
  return new Promise((resolve) => {
    const sink = new Sink();
    sink.on('finish', resolve);
    sink.write(1); sink.write(2); sink.end();
  });
}
function pump() {
  return new Promise((resolve) => {
    const out = new Sink();
    out.on('finish', resolve);
    new Source().pipe(new Doubler()).pipe(out);
  });
}
module.exports = { Sink, Source, Doubler, drive, pump };
