'use strict';
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const showItem = require('./lib/show');

function wrap(fn) { return (req, res, next) => fn(req, res).catch(next); }
function makeHandler() { return (req, res) => res.end(); }
function showW(req, res) { return res.json([]); }
function listR(req, res) { return res.json([]); }
function logDocs(ui) { return ui; }
const guarded = wrap(async (req, res) => listR(req, res));
const specs = { openapi: '3.0.0' };

const app = express();
app.get('/w', wrap(async (req, res) => showW(req, res)));
app.get('/r', wrap(listR));
app.get('/m', makeHandler());
app.get('/g', guarded);
app.get('/s', showItem);
app.get('/docs', swaggerUi.setup(specs, { onComplete: logDocs }));

module.exports = app;
