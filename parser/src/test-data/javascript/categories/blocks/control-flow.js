// fixture: cjs/blocks/control-flow.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018 (for await) for everything except the final class, which
//   needs ES2022 for its static field and static initialisation block. Those
//   two lines are the only above-baseline syntax in the file and can be excised
//   without touching anything else — but CLASS_STATIC_BLOCK is a declared
//   js_block kind AND a declared js_scope kind, so excising them leaves two
//   enum values with no fixture. See MANIFEST.md's syntax-floor table.
//
// Port of java/blocks/ControlFlowExamples.java and NestedBlockLinking.java.
// Every js_block kind that is not an exception form: FUNCTION_BODY, BLOCK, IF,
// ELSE, FOR, FOR_IN, FOR_OF, WHILE, DO, SWITCH, SWITCH_CASE, LABELED,
// CLASS_BODY, CLASS_STATIC_BLOCK, MODULE_BODY.
//
// `label` is a column because TypeScript's enum audit found `outer: for (...)`
// emitting the loop and DROPPING the label — a correctly positioned row with a
// missing sibling, invisible to every count-based check. Labels appear in both
// their forms here: on a loop and on a bare block.
//
// The block/scope distinction the schema draws is visible throughout: a block is
// SYNTAX, a scope is BINDING. A bare `{}` containing only `var` opens no scope,
// and js_block.opensScope says so.

'use strict';

const items = [1, 2, 3];
const obj = { a: 1, b: 2 };

function everyLoopForm(n) {
  const out = [];

  for (let i = 0; i < n; i += 1) { out.push(i); }

  // A for with an empty head in every slot, and one with no body block at all.
  let j = 0;
  for (;;) { if (j++ > 2) { break; } }
  for (let k = 0; k < 2; k += 1) out.push(k);   // no braces: the body is a statement

  // Comma operator in both the init and the update.
  for (let a = 0, b = 10; a < b; a += 1, b -= 1) { out.push(a + b); }

  for (const key in obj) { out.push(key); }
  for (const value of items) { out.push(value); }

  // Destructuring in a for-of head.
  for (const [index, value] of items.entries()) { out.push(index + value); }

  while (out.length < 20) { out.push(0); }

  do { out.pop(); } while (out.length > 15);

  return out;
}

async function asyncLoops(stream) {
  const out = [];
  for await (const chunk of stream) { out.push(chunk); }
  return out;
}

function branching(value) {
  if (value > 10) {
    return 'big';
  } else if (value > 5) {
    return 'medium';
  } else {
    return 'small';
  }
}

// An if with no braces, an else with no braces, and a dangling else — the shape
// §6 of BUILDING-A-PARSER.md warns about in extractor code, present here as
// input rather than as implementation.
function unbraced(value) {
  if (value) return 'yes';
  else return 'no';
}

function nestedDangling(a, b) {
  if (a)
    if (b) return 'both';
    else return 'a only';        // binds to the INNER if
  return 'neither';
}

function switching(kind) {
  switch (kind) {
    case 'a':
    case 'b':
      // Two case labels, one body. Fall-through between them is intentional
      // and invisible.
      return 'ab';
    case 'c': {
      // A braced case body opens a real block AND a scope.
      const local = 'c';
      return local;
    }
    case 'd':
      // Deliberate fall-through with no break.
      kind = 'e';
    case 'e':
      return 'de';
    default:
      return 'other';
  }
}

// A switch with the default in the MIDDLE, which is legal and changes nothing
// about matching order.
function defaultInMiddle(kind) {
  switch (kind) {
    case 1: return 'one';
    default: return 'other';
    case 2: return 'two';
  }
}

// Labels: on a loop, on a nested loop, and on a bare block. `break label` from
// a block is the closest JavaScript has to a goto.
function labelled(matrix) {
  const found = [];
  outer:
  for (const row of matrix) {
    inner:
    for (const cell of row) {
      if (cell === 0) { continue outer; }
      if (cell < 0) { break outer; }
      if (cell === 99) { break inner; }
      found.push(cell);
    }
  }

  block: {
    if (found.length === 0) { break block; }
    found.push(-1);
  }

  return found;
}

// A bare block containing only `var`. It is a BLOCK with opensScope = false —
// the block exists in the syntax and creates no binding scope, which is the
// distinction js_block and js_scope are two relations for.
function bareBlock() {
  {
    var notScoped = 1;
  }
  {
    let scoped = 2;
    return notScoped + scoped;
  }
}

// Four-deep nesting, with a function boundary in the middle so the block tree
// and the scope tree diverge.
function deeplyNested(input) {
  if (input) {
    for (const x of input) {
      while (x > 0) {
        try {
          const inner = () => {
            switch (x) {
              case 1: {
                return 'one';
              }
              default:
                return 'many';
            }
          };
          return inner();
        } finally {
          break;
        }
      }
    }
  }
  return null;
}

class WithStaticBlock {
  static registry = null;          // [ES2022] static class field
  static {                          // [ES2022] static initialisation block
    WithStaticBlock.registry = new Map();
  }
  method() {
    // A class method body is a FUNCTION_BODY block whose parent is a CLASS_BODY.
    { return WithStaticBlock.registry; }
  }
}

module.exports = {
  everyLoopForm, asyncLoops, branching, unbraced, nestedDangling,
  switching, defaultInMiddle, labelled, bareBlock, deeplyNested, WithStaticBlock
};
