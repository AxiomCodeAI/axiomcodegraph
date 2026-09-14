'use strict';
const __axiom = require("./__axiom_runtime.js"); const __p = __axiom.enter("app.js:1:1");
const express = require('express');
const { requestId, timing, errorHandler } = require('./middleware');
const routes = require('./routes');
function createApp() {
    return __axiom.run("app.js:5:1", () => {
        const app = express();
        app.use(express.json());
        app.use(requestId);
        app.use(timing());
        app.use('/api', routes);
        app.use((req, res) => {
            return __axiom.run("app.js:11:11", () => {
                return res.status(404).json({ error: 'no such route' });
            });
        });
        app.use(errorHandler);
        return app;
    });
}
module.exports = { createApp };

__axiom.exit(__p);
