const express = require('express');
const adminRoutes = require('./routes/admin');
const app = express();
const apiRouter = express.Router();
const publicDir = __dirname + '/public';
apiRouter.use('/admin', adminRoutes);
app.use('/api', apiRouter);
app.use('/static', express.static(publicDir));
module.exports = app;
