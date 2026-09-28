const { normalize } = require('../lib/text');

function sample() {
  return normalize(' hi ');
}

module.exports = { sample };
