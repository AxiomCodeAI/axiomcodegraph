'use strict';
// `normalise` is never CALLED by name outside this file: it is handed to runAll as a value and
// invoked by whoever holds it. The engine records that hand-off as a `callback_registered` edge,
// which is a tier only the JavaScript and TypeScript front ends emit.

function normalise(row) {
  return String(row).trim();
}

function runAll(rows, step) {
  return rows.map(step);
}

function process(rows) {
  return runAll(rows, normalise);
}

module.exports = { normalise, runAll, process };
