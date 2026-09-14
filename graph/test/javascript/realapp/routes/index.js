'use strict';
const express = require('express');
const audit = require('../services/audit');
const router = express.Router();
router.get('/health', (req, res) => res.json({ ok: true, id: req.id }));
router.get('/audit', (req, res) => res.json(audit.history()));
router.use('/todos', require('./todos'));
module.exports = router;
