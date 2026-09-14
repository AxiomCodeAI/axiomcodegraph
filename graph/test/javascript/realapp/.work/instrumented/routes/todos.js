'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("routes/todos.js:1:1");
const express = require('express');
const todos = require('../services/todos');
const { parseId, wrap } = require('../middleware');
const router = express.Router();
router.param('id', parseId);
router.get('/', (req, res) => {
    return __axiom.run("routes/todos.js:7:17", () => {
        res.json(todos.list(req.query.filter));
    });
});
router.post('/', (req, res) => {
    return __axiom.run("routes/todos.js:8:18", () => {
        res.status(201).json(todos.create(req.body));
    });
});
router.get('/:id', function getOne(req, res) {
    return __axiom.run("routes/todos.js:9:20", () => {
        res.json(todos.read(req.todoId));
    });
});
router.post('/:id/toggle', wrap(async (req, res) => {
    return __axiom.run("routes/todos.js:10:33", async () => {
        res.json(await todos.toggle(req.todoId));
    });
}));
router.delete('/:id', (req, res) => {
    return __axiom.run("routes/todos.js:11:23", () => {
        todos.destroy(req.todoId);
        res.status(204).end();
    });
});
module.exports = router;

__axiom.exit(__p);
