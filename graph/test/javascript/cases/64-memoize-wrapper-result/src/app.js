const memoize = require("./memoize");
const { once, lazy, constant, tap, Gamma } = require("./once");
const AlphaPlugin = require("./alpha");
const BetaPlugin = require("./beta");

// Two memoized getters of different modules: each call reaches its own module only.
const getAlpha = memoize(() => require("./alpha"));
const getBeta = memoize(() => require("./beta"));

function hooks(c) {
  getAlpha().getHooks(c);
  getBeta().getHooks(c);
}

// `once` and `lazy` over instances.
const firstAlpha = once(() => new AlphaPlugin());
const makeBeta = lazy(() => new BetaPlugin());
const firstBeta = once(() => new BetaPlugin());
const makeAlpha = lazy(() => new AlphaPlugin());

function runAll() {
  firstAlpha().run();
  makeBeta().run();
  firstBeta().run();
  makeAlpha().run();
}

// CONTROLS: a closure that returns its parameter; one that returns something else.
const keepBeta = constant(new BetaPlugin());
const tapped = tap(() => new AlphaPlugin());

function controls() {
  keepBeta().run();
  tapped().render();
}

module.exports = { hooks, runAll, controls, Gamma };
