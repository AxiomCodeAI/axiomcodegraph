'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("services/todos.js:1:1");
const store = require('../lib/store');
const { NotFound, BadRequest } = require('../lib/errors');
const audit = require('./audit');
function validate(body) {
    return __axiom.run("services/todos.js:5:1", () => {
        if (!body || typeof body.title !== 'string' || !body.title.trim())
            throw new BadRequest('title required');
        return { title: body.title.trim(), done: Boolean(body.done) };
    });
}
function list(filter) {
    return __axiom.run("services/todos.js:9:1", () => {
        return filter === 'open' ? store.find((t) => {
            return __axiom.run("services/todos.js:9:63", () => {
                return !t.done;
            });
        }) : store.all();
    });
}
function create(body) {
    return __axiom.run("services/todos.js:10:1", () => {
        const item = store.insert(validate(body));
        audit.record('create', item);
        return item;
    });
}
function read(id) {
    return __axiom.run("services/todos.js:11:1", () => {
        const item = store.get(id);
        if (!item)
            throw new NotFound('todo ' + id);
        return item;
    });
}
async function toggle(id) {
    return __axiom.run("services/todos.js:12:1", async () => {
        const item = read(id);
        await audit.flush();
        return store.update(id, { done: !item.done });
    });
}
function destroy(id) {
    return __axiom.run("services/todos.js:13:1", () => {
        read(id);
        return store.remove(id);
    });
}
module.exports = { list, create, read, toggle, destroy, validate };

__axiom.exit(__p);
