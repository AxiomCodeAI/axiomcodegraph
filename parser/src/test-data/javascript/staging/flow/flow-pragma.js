/* @flow */
// fixture: flow/flow-pragma.js
// module system: ESM  (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing
// expected provenance: FLOW_REJECTED — comment-only Flow, and the pragma still makes it a Flow file
// syntax floor: ES2015 + Flow comment syntax (which is not syntax at all — it is
//   entirely inside comments, and this file runs unmodified in any engine)
//
// The @flow pragma with NO annotation syntax. js_module.hasFlowPragma is a
// column and js_comment.directiveKind = FLOW_PRAGMA is a value, and both are
// about the DIRECTIVE rather than about any annotation: a file can declare
// itself Flow-checked and carry all its types in comment form.
//
// This is the "comment types" Flow dialect — `/*: T */` and `/*:: ... */` — which
// exists precisely so Flow-typed code can ship without a build step. It is a
// THIRD type-comment dialect beside JSDoc and TypeScript's, and a parser that
// assumes every type comment is JSDoc reads none of it.
//
// Grounded in a Flow-throughout application framework, which opens nearly every file with `/* @flow */`.


import { EventEmitter } from 'node:events';

/*::
type ComponentOptions = {
  name: string,
  data: () => Object,
  props?: Array<string>,
};
export type { ComponentOptions };
*/

export function createComponent(options /*: ComponentOptions */) /*: Object */ {
  return { ...options, _isComponent: true };
}

export const noop = (/*:: ...args: Array<mixed> */) /*: void */ => {};

export class Watcher extends EventEmitter {
  constructor(expression /*: string */) {
    super();
    this.expression = expression /*: string */;
  }
}
