'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("routes/index.js:1:1");
const express = require('express');
const audit = require('../services/audit');
const router = express.Router();
router.get('/health', (req, res) => {
    return __axiom.run("routes/index.js:5:23", () => {
        return res.json({ ok: true, id: req.id });
    });
});
router.get('/audit', (req, res) => {
    return __axiom.run("routes/index.js:6:22", () => {
        return res.json(audit.history());
    });
});
router.use('/todos', require('./todos'));
module.exports = router;

__axiom.exit(__p);
