'use strict';
const __axiom = require("./__axiom_runtime.js"); const __p = __axiom.enter("server.js:1:1");
const { createApp } = require('./app');
function start(port, cb) {
    return __axiom.run("server.js:3:1", () => {
        const app = createApp();
        return app.listen(port, () => {
            return __axiom.run("server.js:3:77", () => {
                return cb && cb(app);
            });
        });
    });
}
if (require.main === module)
    start(3000, () => {
        return __axiom.run("server.js:4:42", () => {
            return console.log('listening');
        });
    });
module.exports = { start };

__axiom.exit(__p);
