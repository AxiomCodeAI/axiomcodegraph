// A DISPATCH TABLE read with a computed key and defaulted, written without a const
// between the default and the call (#1727). Case 61 pins `const h = t[k] || d; h()`;
// these are the same default written inline, or by assigning the variable again. The
// value layer sees only the default, so each used to be a known_edge to it alone.
import { remote } from './table.js';

function fromA(a) { return a; }
function fromB(a) { return a; }
function deep(a) { return [a]; }

const table = { a: fromA, b: fromB };

// THE CONSTRUCT, inline: the default is the callee, `(t[k] || d)()`.
function inlineOr(k, a) { return (table[k] || deep)(a); }

// THE CONSTRUCT, inline with a conditional.
function inlineTernary(k, a) { return (k in table ? table[k] : deep)(a); }

// THE CONSTRUCT, by reassignment: `if (!h) h = d`.
function reassigned(k, a) {
  let h = table[k];
  if (!h) h = deep;
  return h(a);
}

// THE CONSTRUCT, by a logical assignment.
function nullishAssigned(k, a) {
  let h = table[k];
  h ??= deep;
  return h(a);
}

// THE CONSTRUCT, the other way round: the default first, the read assigned over it.
function readAssigned(k, a) {
  let h = deep;
  if (k) h = table[k];
  return h(a);
}

// THE CONSTRUCT, the table imported from another module.
function importedInline(k, a) { return (remote[k] || deep)(a); }
function importedReassigned(k, a) {
  let h = remote[k];
  if (!h) h = deep;
  return h(a);
}

// CONTROL 1: an inline default whose key is WRITTEN AS A LITERAL: fromA and deep only.
function inlineLiteralKey(a) { return (table['a'] || deep)(a); }

// CONTROL 2: a dotted read reassigned: fromB and deep only.
function reassignedDotted(a) {
  let h = table.b;
  if (!h) h = deep;
  return h(a);
}

// CONTROL 3: a variable reassigned with no table read at all: fromA and deep only.
function reassignedPlain(k, a) {
  let h = fromA;
  if (k) h = deep;
  return h(a);
}

// CONTROL 4: the default alone, inline. The one known target stays a known_edge.
function inlineDefaultOnly(k, a) { return (k || deep)(a); }

const key = process.argv[2];
inlineOr(key, 1);
inlineTernary(key, 1);
reassigned(key, 1);
nullishAssigned(key, 1);
readAssigned(key, 1);
importedInline(key, 1);
importedReassigned(key, 1);
inlineLiteralKey(1);
reassignedDotted(1);
reassignedPlain(key, 1);
inlineDefaultOnly(key, 1);
