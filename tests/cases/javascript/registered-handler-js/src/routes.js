'use strict';
const express = require('express');

function listPads(req, res) {
  res.json([]);
}

function auditLog(event) {
  return event;
}

const app = express();
app.get('/pads', listPads);
setTimeout(auditLog, 1000);

module.exports = app;
