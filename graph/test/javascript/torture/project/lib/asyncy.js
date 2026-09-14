'use strict';
// ── promises, async/await, timers, nextTick, callbacks through the platform ──
function delay(v) { return new Promise((resolve) => setTimeout(() => resolve(v), 1)); }
function step1(v) { return v + 1; }
function step2(v) { return v * 2; }
function onError(e) { return String(e); }
async function pipeline(v) {
  const a = await delay(v);
  const b = await Promise.resolve(a).then(step1).then((x) => step2(x), onError);
  return b;
}
function later(fn) { setImmediate(fn); process.nextTick(() => fn(1)); }
function withCallback(v, cb) { cb(null, step1(v)); }
function promisify(f) { return (v) => new Promise((res, rej) => f(v, (err, out) => (err ? rej(err) : res(out)))); }
const withCallbackP = promisify(withCallback);
module.exports = { delay, step1, step2, pipeline, later, withCallback, withCallbackP, onError };
