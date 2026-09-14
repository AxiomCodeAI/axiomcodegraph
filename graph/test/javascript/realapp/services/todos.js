'use strict';
const store = require('../lib/store');
const { NotFound, BadRequest } = require('../lib/errors');
const audit = require('./audit');
function validate(body) {
  if (!body || typeof body.title !== 'string' || !body.title.trim()) throw new BadRequest('title required');
  return { title: body.title.trim(), done: Boolean(body.done) };
}
function list(filter) { return filter === 'open' ? store.find((t) => !t.done) : store.all(); }
function create(body) { const item = store.insert(validate(body)); audit.record('create', item); return item; }
function read(id) { const item = store.get(id); if (!item) throw new NotFound('todo ' + id); return item; }
async function toggle(id) { const item = read(id); await audit.flush(); return store.update(id, { done: !item.done }); }
function destroy(id) { read(id); return store.remove(id); }
module.exports = { list, create, read, toggle, destroy, validate };
