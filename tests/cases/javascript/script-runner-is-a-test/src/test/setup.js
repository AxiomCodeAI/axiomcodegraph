// loaded by the runner before the framework tests (a setup file), never run on its own
const { normalize } = require('../lib/text');

globalThis.normalized = normalize(' SETUP ');
