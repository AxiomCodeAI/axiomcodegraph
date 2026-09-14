// fixture: cjs/expressions/operators.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2021 (logical assignment: &&= ||= ??=)
//
// Port of java/expressions/AssignmentExpressionExamples.java.
//
// THE RULE THIS FIXTURE EXISTS FOR: one ASSIGNMENT kind covers every compound
// form, with the operator in `operatorString` as a COLUMN. Java established it,
// TypeScript follows it, and Python's failure to establish it left 1,276
// statements unpairable — target and value both depth-0 roots with no wrapper.
//
// The two tests that catch the flat form are both here:
//   - `a += 1; b += 2;` on ONE LINE. Flat emission gives four depth-0 rows and
//     the engine-side workaround pairs them on (scope, line, rootContext),
//     yielding four pairs of which two INVENT value flow: `a` paired with `2`.
//   - a compound assignment NESTED in something that emits no row of its own.

'use strict';

let a = 1, b = 2, c = 3;
const arr = [1, 2, 3];
const obj = { x: 1, y: { z: 2 } };

// --- arithmetic, comparison, logical, bitwise ---------------------------------------

const arithmetic = [a + b, a - b, a * b, a / b, a % b, a ** b];
const comparison = [a < b, a > b, a <= b, a >= b];
const equality = [a === b, a !== b, a == b, a != b];
const logical = [a && b, a || b, a ?? b];
const bitwise = [a & b, a | b, a ^ b, ~a];
const shifts = [a << 2, a >> 2, a >>> 2];
const stringConcat = 'a' + 1 + true + null + undefined + [] + {};

// Right-associative exponentiation, and the parenthesisation it forces on the
// left operand — `-a ** b` is a syntax error.
const power = 2 ** 3 ** 2;
const negatedPower = (-a) ** 2;

// --- every compound assignment -------------------------------------------------------
//
// One kind, thirteen operators, thirteen values of operatorString.

a += 1;  a -= 1;  a *= 2;  a /= 2;  a %= 3;  a **= 2;
a <<= 1; a >>= 1; a >>>= 1;
a &= 7;  a |= 8;  a ^= 3;
let n = null;
n ??= 'nullish assigned';
let truthy = 1;
truthy &&= 2;
let falsy = 0;
falsy ||= 3;

// TWO COMPOUND ASSIGNMENTS ON ONE LINE. This is the case flat emission gets
// wrong by inventing `a` paired with `2`.
a += 1; b += 2;

// Three on one line, with a member target and a computed target among them.
obj.x += 1; arr[0] += 2; obj.y.z += 3;

// A compound assignment nested inside a parenthesised expression, a ternary and
// a call argument — each a position where a subtree rooted at a non-emitting
// node has died in a real parser.
const nestedInParens = ((a += 1));
const nestedInTernary = b > 0 ? (a += 1) : (a -= 1);
const nestedInArgument = Math.max((a += 1), (b += 2));
const nestedInTemplate = `${a += 1}`;
const nestedInArray = [(a += 1), (b += 2)];

// Chained plain assignment: right-associative, three targets, one value.
let p, q, r;
p = q = r = 5;

// Assignment as an expression, used for its value.
const usedAsValue = (a = 10) + (b = 20);

// --- destructuring assignment (not declaration) ------------------------------------------
//
// The target is a PATTERN and there is no `const`. The parenthesised object form
// is required, because a statement cannot begin with `{`.

let x, y, rest;
[x, y] = [1, 2];
[x, y] = [y, x];                        // swap
({ x, y } = { x: 3, y: 4 });
[x, ...rest] = [1, 2, 3];
({ x = 9, ...rest } = { y: 1 });
[obj.x, arr[1]] = [10, 20];             // member expressions as targets
[[x], { y }] = [[1], { y: 2 }];         // nested patterns

// --- unary and update ---------------------------------------------------------------------

const unary = [+a, -a, !a, ~a, typeof a, void a, delete obj.x];
let counter = 0;
const postIncrement = counter++;
const preIncrement = ++counter;
const postDecrement = counter--;
const preDecrement = --counter;

// --- relational and type operators ----------------------------------------------------------

const inOperator = 'x' in obj;
const instanceOf = arr instanceof Array;
const typeofUndeclared = typeof neverDeclared;   // the only safe undeclared read

// --- conditional, comma, sequence -------------------------------------------------------------

const ternary = a > b ? 'a' : 'b';
const nestedTernary = a > b ? (a > c ? 'a' : 'c') : (b > c ? 'b' : 'c');
const comma = (a++, b++, c);
const inForHead = (function () { for (let i = 0, j = 10; i < j; i++, j--) { } return 'done'; })();

// --- optional chaining and nullish, as OPERATORS --------------------------------------------

const maybe = process.env.NOTHING ? obj : null;
const optionalMember = maybe?.x;
const optionalComputed = maybe?.['x'];
const optionalDeep = maybe?.y?.z;
const nullishDefault = maybe?.x ?? 'default';
const mixedPrecedence = (maybe?.x ?? 0) + 1;

// --- await and yield as operators --------------------------------------------------------------

async function operatorsInAsync(promise) {
  const awaited = await promise;
  const awaitedExpression = (await promise) + 1;
  return awaited + awaitedExpression;
}

function* operatorsInGenerator(inner) {
  const received = yield 1;
  const delegated = yield* inner;
  return received + delegated;
}

// --- new.target, a meta-property that is neither a member access nor an identifier ------------

function metaProperty() {
  return new.target;
}

module.exports = {
  arithmetic, comparison, equality, logical, bitwise, shifts, stringConcat,
  power, negatedPower, n, truthy, falsy, nestedInParens, nestedInTernary,
  nestedInArgument, nestedInTemplate, nestedInArray, p, q, r, usedAsValue,
  x, y, rest, unary, postIncrement, preIncrement, postDecrement, preDecrement,
  inOperator, instanceOf, typeofUndeclared, ternary, nestedTernary, comma,
  inForHead, optionalMember, optionalComputed, optionalDeep, nullishDefault,
  mixedPrecedence, operatorsInAsync, operatorsInGenerator, metaProperty
};
