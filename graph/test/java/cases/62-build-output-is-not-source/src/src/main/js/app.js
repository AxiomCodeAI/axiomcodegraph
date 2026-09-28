const aim = require('./target/aim');

function start(order) {
  return aim.point(order);
}

module.exports = { start };
