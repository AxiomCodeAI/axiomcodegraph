// fixture: verified/parenthesised-heritage/paren-extends.js
// nature: runtime-bearing
// VERIFIED REPRO — redundant parentheses around an `extends` clause turn a
// resolvable inheritance edge into a "computed" one with an unusable name.
//
// Verified against js-impl@527770c (pushed). Source only; no expected facts.
//
// THREE CONTROLS FIRST, all correct in the same file:
//     class A extends Base        -> superTypeName "Base",  isComputed false
//     class B extends NS.Inner    -> superTypeName "Inner", text "NS.Inner", false
//     class C extends Mixin(Base) -> isComputed TRUE, and rightly so — a mixin
//                                    call really is computed
//
// AND THE THREE THAT ARE WRONG:
//     class D extends (Base)      -> superTypeName "(Base)",            isComputed TRUE
//     class E extends (\n NS.Inner \n) -> superTypeName "(\n\tNS.Inner\n)", TRUE
//     class F extends ((Base))    -> superTypeName "((Base))",          TRUE
//
// The row is not lost. Its NAME is unusable and its FLAG is wrong, which is the
// class §4 names: a correctly-positioned row that every count-based check passes.
// `isComputedSuperclass` exists to say "do not trust superTypeName as a name
// here", so setting it on a plain name in redundant parentheses tells an engine
// to discard an edge it could have followed.
//
// §6 of BUILDING-A-PARSER.md is the rule this is missing: unwrap parentheses in
// ONE place at the root. The same omission cost the TypeScript front end 1,808
// expressions on `return ( a && b.c() )`.
//
// SCALE: 43 of 1,988 heritage edges in the corpus (2.2%), all in one bundler's source, all
// prettier wrapping a long `extends` clause onto its own line. The 44th
// non-plain name is node's `EventEmitterMixin(JSTransferable)`, which is
// genuinely computed and correctly flagged.
//
// HOW IT WAS FOUND, because the route matters: not by my sweep, which adjudicates
// call sites and is blind to heritage. js-impl's own AST-recall measurement
// reported 43 `ExpressionWithTypeArguments` nodes with no expression row; that
// residue was undocumented, and following it here is what turned an accounted-for
// gap into a defect.
//
// module system: CommonJS, governed by verified/package.json.
'use strict';
const Base = class {};
const NS = { Inner: class {} };
function Mixin(B) { return class extends B {}; }

class A extends Base {}
class B extends NS.Inner {}
class C extends Mixin(Base) {}

class D extends (Base) {}
class E extends (
	NS.Inner
) {}
class F extends ((Base)) {}

module.exports = { A, B, C, D, E, F };
