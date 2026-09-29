'use strict';
const express = require('express');
const { requireUser } = require('./lib/auth');

function listItems(req, res) { res.json([]); }
function createItem(req, res) { res.status(201).end(); }
function removeItem(req, res) { res.status(204).end(); }

const router = express.Router();
router.get('/items', listItems);
router.post('/items', requireUser, (req, res) => createItem(req, res));
router.delete('/items/:id', removeItem);

module.exports = router;
