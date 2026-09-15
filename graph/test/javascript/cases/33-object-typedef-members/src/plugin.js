/** @typedef {import("./Parser").Parser} Parser */
/** @typedef {import("./Parser").ParserStateBase} ParserStateBase */
/** @typedef {import("./NormalModule")} NormalModule */
/** @param {Parser} parser */
function apply(parser) { return parser.state.module.addDependency(1); }
/** @param {ParserStateBase} state */
function direct(state) { return state.module.addDependency(2); }
/** @param {{ module: NormalModule, name: string }} opts */
function inline(opts) { return opts.module.addDependency(3); }
/** @param {ParserStateBase} state */
function viaArray(state) { for (const m of state.extra) { m.addDependency(4); } }
/** @param {ParserStateBase} state */
function viaString(state) { return state.source.trim(); }
module.exports = { apply, direct, inline, viaArray, viaString };
