'use strict';
class App { start() { return 'app'; } }
function createApp() { return new App(); }
module.exports = { App, createApp };
