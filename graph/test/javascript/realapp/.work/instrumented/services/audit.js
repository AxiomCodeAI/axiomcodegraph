'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("services/audit.js:1:1");
const debug = require('debug')('realapp:audit');
const store = require('../lib/store');
const entries = [];
function record(action, item) {
    return __axiom.run("services/audit.js:5:1", () => {
        entries.push({ action, id: item.id, at: Date.now() });
        debug('%s %d', action, item.id);
    });
}
function flush() {
    return __axiom.run("services/audit.js:6:1", () => {
        return new Promise((resolve) => {
            return __axiom.run("services/audit.js:6:39", () => {
                return setImmediate(() => {
                    return __axiom.run("services/audit.js:6:65", () => {
                        return resolve(entries.length);
                    });
                });
            });
        });
    });
}
function history() {
    return __axiom.run("services/audit.js:7:1", () => {
        return entries.slice();
    });
}
store.on('inserted', (item) => {
    return __axiom.run("services/audit.js:8:22", () => {
        return record('inserted', item);
    });
});
store.on('removed', function onRemoved(id) {
    return __axiom.run("services/audit.js:9:21", () => {
        record('removed', { id });
    });
});
module.exports = { record, flush, history };

__axiom.exit(__p);
