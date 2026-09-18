// Loaded into a FRESH V8 context by main.js. Once rewritten it names `__ax`, which
// that context does not have, so this file is the case for the per-file guard.
function twice(x) {
  'use strict'
  return x * 2
}
module.exports = { twice }
