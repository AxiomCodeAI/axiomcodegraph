'use strict';
const { main, dynamic } = require('./queue');
main();
try { dynamic(Symbol('other')); } catch (e) { /* no such member */ }
