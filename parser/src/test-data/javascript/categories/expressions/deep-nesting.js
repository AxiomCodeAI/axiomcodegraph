// fixture: cjs/expressions/deep-nesting.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// GENERATED, and the only generated file in this corpus. Everything else here is
// derived from real code; this one cannot be, because its whole content is a
// depth no human writes deliberately — which is exactly why it is needed.
//
// The schema caps js_expression and js_type_reference traversal at depth 32 and
// records isTruncated beyond it, with js_parse_gap.gapKind = DEPTH_CAP_REACHED.
// TypeScript capped at 20 and the memo measured a real maximum of 67, so the cap
// is the difference between the two. Until this file existed the whole staging
// corpus stayed under the cap, so isTruncated was never true, DEPTH_CAP_REACHED
// carried zero rows, and the cap had never once been exercised.
//
// A cap that is never reached is a check that cannot fail. Five shapes reach it
// by different routes, because a walker may cap one and not another:
//   1. left-associative binary chain, 45 deep
//   2. nested conditional (ternary) ladder, 39 deep
//   3. member-access chain, 39 deep
//   4. nested call arguments, 35 deep
//   5. nested array literals, 37 deep
//
// Real provenance, so this is not purely synthetic: minified and bundled output
// reaches these depths constantly, generated parsers emit
// ternary ladders of exactly this shape, and a long `a && b && c && ...` guard
// chain in hand-written code is the same tree.

'use strict';

const a = 0;
const b1 = 1;
const b2 = 2;
const b3 = 3;
const b4 = 4;
const b5 = 5;
const b6 = 6;
const b7 = 7;
const b8 = 8;
const b9 = 9;
const b10 = 10;
const b11 = 11;
const b12 = 12;
const b13 = 13;
const b14 = 14;
const b15 = 15;
const b16 = 16;
const b17 = 17;
const b18 = 18;
const b19 = 19;
const b20 = 20;
const b21 = 21;
const b22 = 22;
const b23 = 23;
const b24 = 24;
const b25 = 25;
const b26 = 26;
const b27 = 27;
const b28 = 28;
const b29 = 29;
const b30 = 30;
const b31 = 31;
const b32 = 32;
const b33 = 33;
const b34 = 34;
const b35 = 35;
const b36 = 36;
const b37 = 37;
const b38 = 38;
const b39 = 39;
const b40 = 40;
const b41 = 41;
const b42 = 42;
const b43 = 43;
const b44 = 44;
const b45 = 45;
const c1 = 1 % 2 === 0, d1 = 1;
const c2 = 2 % 2 === 0, d2 = 2;
const c3 = 3 % 2 === 0, d3 = 3;
const c4 = 4 % 2 === 0, d4 = 4;
const c5 = 5 % 2 === 0, d5 = 5;
const c6 = 6 % 2 === 0, d6 = 6;
const c7 = 7 % 2 === 0, d7 = 7;
const c8 = 8 % 2 === 0, d8 = 8;
const c9 = 9 % 2 === 0, d9 = 9;
const c10 = 10 % 2 === 0, d10 = 10;
const c11 = 11 % 2 === 0, d11 = 11;
const c12 = 12 % 2 === 0, d12 = 12;
const c13 = 13 % 2 === 0, d13 = 13;
const c14 = 14 % 2 === 0, d14 = 14;
const c15 = 15 % 2 === 0, d15 = 15;
const c16 = 16 % 2 === 0, d16 = 16;
const c17 = 17 % 2 === 0, d17 = 17;
const c18 = 18 % 2 === 0, d18 = 18;
const c19 = 19 % 2 === 0, d19 = 19;
const c20 = 20 % 2 === 0, d20 = 20;
const c21 = 21 % 2 === 0, d21 = 21;
const c22 = 22 % 2 === 0, d22 = 22;
const c23 = 23 % 2 === 0, d23 = 23;
const c24 = 24 % 2 === 0, d24 = 24;
const c25 = 25 % 2 === 0, d25 = 25;
const c26 = 26 % 2 === 0, d26 = 26;
const c27 = 27 % 2 === 0, d27 = 27;
const c28 = 28 % 2 === 0, d28 = 28;
const c29 = 29 % 2 === 0, d29 = 29;
const c30 = 30 % 2 === 0, d30 = 30;
const c31 = 31 % 2 === 0, d31 = 31;
const c32 = 32 % 2 === 0, d32 = 32;
const c33 = 33 % 2 === 0, d33 = 33;
const c34 = 34 % 2 === 0, d34 = 34;
const c35 = 35 % 2 === 0, d35 = 35;
const c36 = 36 % 2 === 0, d36 = 36;
const c37 = 37 % 2 === 0, d37 = 37;
const c38 = 38 % 2 === 0, d38 = 38;
const c39 = 39 % 2 === 0, d39 = 39;
const wrap0 = (v) => v;
const wrap1 = (v) => v;
const wrap2 = (v) => v;
const wrap3 = (v) => v;
const root = { p1: { } };
const x = 1;
function seed() { return 0; }

// 1. binary chain
const binaryChain = (((((((((((((((((((((((((((((((((((((((((((((a + b1) + b2) + b3) + b4) + b5) + b6) + b7) + b8) + b9) + b10) + b11) + b12) + b13) + b14) + b15) + b16) + b17) + b18) + b19) + b20) + b21) + b22) + b23) + b24) + b25) + b26) + b27) + b28) + b29) + b30) + b31) + b32) + b33) + b34) + b35) + b36) + b37) + b38) + b39) + b40) + b41) + b42) + b43) + b44) + b45);

// 2. ternary ladder
const ternaryLadder = (c39 ? (c38 ? (c37 ? (c36 ? (c35 ? (c34 ? (c33 ? (c32 ? (c31 ? (c30 ? (c29 ? (c28 ? (c27 ? (c26 ? (c25 ? (c24 ? (c23 ? (c22 ? (c21 ? (c20 ? (c19 ? (c18 ? (c17 ? (c16 ? (c15 ? (c14 ? (c13 ? (c12 ? (c11 ? (c10 ? (c9 ? (c8 ? (c7 ? (c6 ? (c5 ? (c4 ? (c3 ? (c2 ? (c1 ? x : d1) : d2) : d3) : d4) : d5) : d6) : d7) : d8) : d9) : d10) : d11) : d12) : d13) : d14) : d15) : d16) : d17) : d18) : d19) : d20) : d21) : d22) : d23) : d24) : d25) : d26) : d27) : d28) : d29) : d30) : d31) : d32) : d33) : d34) : d35) : d36) : d37) : d38) : d39);

// 3. member chain — reads a property 39 levels down and throws at runtime;
//    the SHAPE is the point, and nothing calls this.
function memberChain() {
  return root.p1.p2.p3.p4.p5.p6.p7.p8.p9.p10.p11.p12.p13.p14.p15.p16.p17.p18.p19.p20.p21.p22.p23.p24.p25.p26.p27.p28.p29.p30.p31.p32.p33.p34.p35.p36.p37.p38.p39;
}

// 4. nested calls
const nestedCalls = wrap3(wrap2(wrap1(wrap0(wrap3(wrap2(wrap1(wrap0(wrap3(wrap2(wrap1(wrap0(wrap3(wrap2(wrap1(wrap0(wrap3(wrap2(wrap1(wrap0(wrap3(wrap2(wrap1(wrap0(wrap3(wrap2(wrap1(wrap0(wrap3(wrap2(wrap1(wrap0(wrap3(wrap2(wrap1(seed())))))))))))))))))))))))))))))))))));

// 6. THE OTHER DEPTH CAP: a JSDoc type expression.
//
// js_type_reference is capped at 32 exactly as js_expression is, and the audit
// for columns nothing discriminates found `type-references.isTruncated` FALSE in
// every row — the expression cap was exercised and the type cap never was. A
// type expression is a TREE, so `Array<Array<...>>` 40 deep is 40 rows and the
// cap must bite at the same place.

/**
 * @param {Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<Array<string>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>} deepType
 * @returns {void}
 */
function deepJsdocType(deepType) { return undefined; }

// 5. nested array literals
const nestedArrays = [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]];

module.exports = {
  binaryChain, ternaryLadder, memberChain, nestedCalls, nestedArrays, deepJsdocType
};
