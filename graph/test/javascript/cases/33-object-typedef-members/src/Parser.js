// An object typedef with @property members (#651), the JSDoc record type.
/** @typedef {import("./NormalModule")} NormalModule */
/**
 * @typedef {Object} ParserStateBase
 * @property {NormalModule} module
 * @property {string} source
 * @property {NormalModule[]} extra
 */
/** @typedef {Record<string, any> & ParserStateBase} ParserState */
class Parser {
  constructor() {
    /** @type {ParserState} */
    this.state = undefined;
  }
  run() { return this.state.module.addDependency(0); }
}
module.exports = { Parser };
