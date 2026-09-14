// fixture: categories/directives/module-attached-comments.js
// nature: runtime-bearing
#!/usr/bin/env node
/*!
 * JsCommentAttachmentKind.MODULE — declared, zero rows.
 *
 * The enum's own docstring names exactly three things: "a file-level comment: a
 * licence header, a @flow pragma, a shebang". This file has the licence header
 * and the shebang; flow/flow-pragma.js has the third. All of them are emitted
 * with attachedToKind = NONE.
 *
 * NONE is the value for "not attached to anything", and a file-level comment IS
 * attached to something — the module. Collapsing the two loses the distinction
 * between a licence header and a stray comment in the middle of a function, which
 * is the distinction the value exists to make.
 *
 * MODULE was invisible to whole-cell matching because the string MODULE is also a
 * value of JsScopeKind and of JsBindingResolution, and both of those emit.
 *
 * module system: CommonJS, governed by categories/package.json.
 */
'use strict';

// A comment attached to a variable — the control.
const attachedToAVariable = 1;

/** A JSDoc attached to a method — the second control. */
function attachedToAMethod() { return attachedToAVariable; }

module.exports = { attachedToAMethod };
