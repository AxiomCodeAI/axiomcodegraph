'use strict';
class Widget { run() { return 'w'; } }
class Gadget { run() { return 'g'; } spin() { return 's'; } }
/** @typedef {{ run: function(): string }} Runnable */
/** @callback Handler @param {Widget} w @returns {string} */
/** @typedef {Object} Options @property {Widget} widget @property {Handler} onDone */
module.exports = { Widget, Gadget };
