'use strict';
const { createApp } = require('./app');
function start(port, cb) { const app = createApp(); return app.listen(port, () => cb && cb(app)); }
if (require.main === module) start(3000, () => console.log('listening'));
module.exports = { start };
