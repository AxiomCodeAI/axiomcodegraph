'use strict';
const debug = require('debug')('realapp:audit');
const store = require('../lib/store');
const entries = [];
function record(action, item) { entries.push({ action, id: item.id, at: Date.now() }); debug('%s %d', action, item.id); }
function flush() { return new Promise((resolve) => setImmediate(() => resolve(entries.length))); }
function history() { return entries.slice(); }
store.on('inserted', (item) => record('inserted', item));
store.on('removed', function onRemoved(id) { record('removed', { id }); });
module.exports = { record, flush, history };
