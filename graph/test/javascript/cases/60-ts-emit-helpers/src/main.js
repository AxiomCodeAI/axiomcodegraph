'use strict';
// A dependency compiled from TypeScript to CommonJS re-exports through the emit
// helpers, so the barrel exposed no name and every call into the package was declared
// unknown although the import resolved and the package was staged (#717).
const { Client } = require('tspkg');

function send() { return new Client().send('x'); }
module.exports = { send };
