'use strict';
const A = require('./lib/async');
async function main() {
  A.generators(); await A.asyncIter(); await A.promises(); A.platformCallbacks();
  new A.Emitter().fire().fireDynamic('a'); A.externalRegistration();
}
main();
