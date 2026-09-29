const { A, swapped, lazyGuard, lazyOrDefault, lazyNullish, plain, otherWritten } = require("./wrap");

function replaced() {
  const sw = swapped(() => new A());
  sw().replacedOnly();
  sw().aOnly();
  lazyGuard(undefined)().replacedOnly();
  lazyGuard(() => new A())().aOnly();
  lazyOrDefault()().dfltOnly();
  lazyOrDefault(() => new A())().aOnly();
  lazyNullish()().dfltOnly();
}

function controls() {
  plain(() => new A())().aOnly();
  plain(() => new A())().replacedOnly();
  otherWritten(() => new A(), null)().aOnly();
  otherWritten(() => new A(), null)().replacedOnly();
}

module.exports = { replaced, controls };
