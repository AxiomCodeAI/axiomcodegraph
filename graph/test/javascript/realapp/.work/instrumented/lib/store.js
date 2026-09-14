'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("lib/store.js:1:1");
const EventEmitter = require('events');
const _ = require('lodash');
class Store extends EventEmitter {
    constructor() {
        return __axiom.run("lib/store.js:5:3", () => {
            super();
            this.items = new Map();
            this.seq = 0;
        });
    }
    all() {
        return __axiom.run("lib/store.js:6:3", () => {
            return Array.from(this.items.values());
        });
    }
    get(id) {
        return __axiom.run("lib/store.js:7:3", () => {
            return this.items.get(id);
        });
    }
    insert(data) {
        return __axiom.run("lib/store.js:8:3", () => {
            const item = Object.assign({ id: ++this.seq }, data);
            this.items.set(item.id, item);
            this.emit('inserted', item);
            return item;
        });
    }
    update(id, patch) {
        return __axiom.run("lib/store.js:9:3", () => {
            const cur = this.get(id);
            if (!cur)
                return null;
            const next = _.merge({}, cur, patch);
            this.items.set(id, next);
            this.emit('updated', next);
            return next;
        });
    }
    remove(id) {
        return __axiom.run("lib/store.js:10:3", () => {
            const ok = this.items.delete(id);
            if (ok)
                this.emit('removed', id);
            return ok;
        });
    }
    find(pred) {
        return __axiom.run("lib/store.js:11:3", () => {
            return this.all().filter(pred);
        });
    }
}
module.exports = new Store();
module.exports.Store = Store;

__axiom.exit(__p);
