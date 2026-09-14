'use strict';
const express = require('express');
const { requestId, timing, errorHandler } = require('./middleware');
const routes = require('./routes');
function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use(timing());
  app.use('/api', routes);
  app.use((req, res) => res.status(404).json({ error: 'no such route' }));
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
