'use strict';
const EventEmitter = require('events');
const _ = require('lodash');
class Store extends EventEmitter {
  constructor() { super(); this.items = new Map(); this.seq = 0; }
  all() { return Array.from(this.items.values()); }
  get(id) { return this.items.get(id); }
  insert(data) { const item = Object.assign({ id: ++this.seq }, data); this.items.set(item.id, item); this.emit('inserted', item); return item; }
  update(id, patch) { const cur = this.get(id); if (!cur) return null; const next = _.merge({}, cur, patch); this.items.set(id, next); this.emit('updated', next); return next; }
  remove(id) { const ok = this.items.delete(id); if (ok) this.emit('removed', id); return ok; }
  find(pred) { return this.all().filter(pred); }
}
module.exports = new Store();
module.exports.Store = Store;
