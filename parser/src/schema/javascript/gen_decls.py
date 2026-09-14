#!/usr/bin/env python3
"""Generate decls_base_js.dl FROM the schema doc's own column tables.

Arities come out of the '### 3.N `js_x` / `lib_js_x` — N columns' headers and are
cross-checked against the numbered rows of each table, so the .dl cannot drift from
schema.json. Run with --check to diff instead of write (for CI).

Why generated: a hand-maintained .dl drifts silently. Column ORDER is the contract
with the Souffle engine, and the .dl carries only c0..cN — so a column rename is free
post-freeze and a reorder is not. Generating it is what makes that asymmetry safe.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.join(HERE, "schema.json")
OUT = os.path.join(HERE, "decls_base_js.dl")

#: One-line-plus purpose per relation. Kept HERE rather than in the doc because the
#: .dl is what an engine author reads first, and it must stand alone.
DOCS = {
 "js_module":
   "A .js/.mjs/.cjs/.jsx file. One row per file, always — JavaScript has no `declare module`.\n"
   "// c7 moduleSystem is IN THE KEY: `import` under a CommonJS config is a different program\n"
   "// from `import` under an ESM one. c8 moduleSystemSource says HOW it was decided, because\n"
   "// 91.4% of files are CommonJS by DEFAULT and not by declaration — without it a defaulted\n"
   "// CommonJS and a declared one are indistinguishable. c10 contradictsGoverningConfig is a\n"
   "// FLAG, never a skip: 6.2% of real files contradict their package.json and all of them are\n"
   "// bundler input, which package.json never governs.",
 "js_scope":
   "The binder's output, and the relation with NO ts_* analogue. TypeScript needs no scope\n"
   "// relation because declared types carry resolution; here the oracle resolves only 52.6% of\n"
   "// call sites, so the BINDER is the resolution mechanism. c3 isFunctionScope is what `var`\n"
   "// hoists to; c6 isStrictMode decides whether assignment to an undeclared name creates a\n"
   "// global or throws; c9 hasWithStatement marks a scope where no name is statically\n"
   "// resolvable, which is the honest answer rather than confident wrong bindings.",
 "js_type":
   "A type DECLARATION: ES class, constructor function with prototype members, or a JSDoc\n"
   "// @typedef/@callback. Object literals are NOT here — they are values. There is deliberately\n"
   "// NO declarationGroupKey: JavaScript has no declaration merging, so TypeScript's central\n"
   "// problem does not exist. c12 evidenceKind = COMMENT_ONLY marks the 677 measured types whose\n"
   "// ONLY evidence is a comment, and c13 isTypeOnly must keep them out of the call graph.",
 "js_type_heritage":
   "One inheritance edge. Separate from js_type because IN JAVASCRIPT AN EXTENDS EDGE CAN BE A\n"
   "// FUNCTION CALL: c2 heritageForm admits UTIL_INHERITS and OBJECT_CREATE_PROTOTYPE alongside\n"
   "// EXTENDS_CLAUSE. c7 resolvedTypeLinkHash is TIER 3 and stays empty — the parser emits the\n"
   "// name as written (c3), the file it came from (c8) and the import hop (c9), and the ENGINE\n"
   "// resolves, exactly as Java's referencedTypeRegistryLinkHash is populated 0 times in 67,938.",
 "js_method":
   "Every callable: function declaration, function expression, arrow, class method, accessor,\n"
   "// prototype-assigned method, and the synthetic <module> initializer. c9 declarationForm\n"
   "// carries PROTOTYPE_ASSIGNMENT / STATIC_ASSIGNMENT — members DECLARED BY ASSIGNMENT (361 and\n"
   "// 521 measured), which is a declaration and an expression at once; c27 ties it back. c10\n"
   "// hoisting separates function declarations (hoisted) from function expressions (not), same\n"
   "// syntax category, different behaviour. c17 thisBinding is LEXICAL for arrows: `this` is\n"
   "// rebound by CALL FORM, 33,189 references measured.",
 "js_method_parameter":
   "A formal parameter. Only 0.165% carry a SYNTACTIC annotation and all of those are Flow, not\n"
   "// TypeScript; 36.4% carry a JSDoc one. So c4 declaredTypeSource is the column that matters\n"
   "// and NONE is the majority value. A destructured parameter is ONE row with c11\n"
   "// patternBindingCount > 0 plus N js_variable rows — emitting N parameter rows would break\n"
   "// c1 position, emitting one with no bindings would lose every name.",
 "js_field":
   "A class field, a prototype property, or a member installed by Object.defineProperty. c3\n"
   "// declarationForm is IN THE KEY because `this.x = 1` in a constructor and `Foo.prototype.x`\n"
   "// at module level are two real declarations of one member. c12 accessorPairKind marks the\n"
   "// members where a property READ invokes a function — which is why GETTER_INVOCATION is a\n"
   "// RESERVED call kind with a zero-row assertion and never emitted from syntax.",
 "js_variable":
   "Every binding that is not a parameter or a member. c2 bindingRegime and the PAIR c3/c4 are\n"
   "// the hoisting model: c3 is where the name is VISIBLE FROM (function scope for var), c4 is\n"
   "// the block it is WRITTEN IN. They differ for every `var` inside a block, and the difference\n"
   "// is NOT recoverable from anything else — an engine would have to reimplement JavaScript\n"
   "// scoping to derive it. c13 initializerKind = REQUIRE_CALL is how a local name becomes a\n"
   "// module alias, which is the hop the engine walks for 83.6% of module edges.",
 "js_import":
   "One module edge IN. 83.6% of these rows are MINTED FROM EXPRESSIONS, not declarations, which\n"
   "// is the finding that made JavaScript its own front end: c2 edgeBearer partitions the table\n"
   "// and c14 sourceExpressionLinkHash points back at the expression so the second pass is\n"
   "// auditable rather than asserted. c4 isTopLevel is FALSE for 13.6% of require() calls, so a\n"
   "// statement-list walk misses one in seven. c12 resolverAgreement records where tsc and Node\n"
   "// disagree (exports maps, conditional exports, #-imports) instead of silently picking.",
 "js_export":
   "One module edge OUT. module.exports = X (2,102), module.exports.x (380), exports.x (118),\n"
   "// plus ESM declarations. c13 overwritesPreviousExport exists because\n"
   "// `exports.a = 1; module.exports = {b}` exports ONLY b — a fact base recording both edges\n"
   "// with no ordering asserts an export that does not exist at runtime. c5 isReExport marks the\n"
   "// 81 measured `module.exports = require('./y')`: one edge that is simultaneously in and out.",
 "js_expression":
   "The spine. c32 introducesDeclarationLinkHash and c33 resolvedParameterLinkHash sit AFTER\n"
   "// the primary key: the schema was\n"
   "// already frozen and appending is the only safe edit, so this is the ONE relation whose PK\n"
   "// is not its last column -- find it by name, never by position. It links an arrow or\n"
   "// function expression to the js_method row it introduces, which is what connects\n"
   "// emitter.on('x', () => {...}) to the body it installs: 31.0% of callables sit in argument\n"
   "// position and 98.2% of those are anonymous, so without it every call inside a callback is\n"
   "// orphaned from the registration that reaches it. NOT c12/c13 -- those mean 'this assignment\n"
   "// declares a member', and widening them would break existing readers silently. c33 is the\n"
   "// SIBLING of c17: c17 is FK->js_variable and a parameter is a js_method_parameter row, so a\n"
   "// reference to a parameter resolved correctly and had nowhere to point -- 137,960 of 158,759\n"
   "// resolved-but-unlinked references, and 58,483 unreachable parameter rows. NOT a widened c17:\n"
   "// a polymorphic FK into two relations defeats the integrity gate, because 'the hash exists in\n"
   "// one of them' is not integrity. No parameter EVER mints a js_variable row, simple or\n"
   "// destructured, so the gap and the fix are both uniform.\n"
   "// ORIGINAL: Reached by an ALLOWLIST of expression positions, never a generic tree walk — a\n"
   "// generic walk puts JSDoc type names in here and type-only constructs then reach the call\n"
   "// graph. c4 operatorString is why one ASSIGNMENT kind covers += -= ??= ||=: the operator is\n"
   "// a COLUMN, not a kind, and the wrapper node with parented children is what makes\n"
   "// `a += 1; b += 2` survive. c10 isModuleEdge marks the rows the import/export second pass\n"
   "// reads; c12 isDeclarationBearing marks the assignments that DECLARE a member.",
 "js_call_site":
   "A call site — 1:1 with its call-like expression, so the key is a pure chain off c16.\n"
   "// require() is NOT here: it is a module edge, and counting it as an unresolved call is what\n"
   "// made the raw resolution figure look worse than it is. c4 receiverPosition admits\n"
   "// FIRST_ARGUMENT because .call/.apply move the receiver INTO an argument (859 sites) and an\n"
   "// engine reading the syntactic receiver gets Function.prototype.call as the target. c12\n"
   "// resolvedMethodLinkHash is TIER 3 and stays empty: the oracle itself decides only 52.6%,\n"
   "// so the parser emits the name, the declared receiver type and the import hop instead.",
 "js_block":
   "A lexical block — SYNTAX, where js_scope is BINDING. One block may open no scope and one\n"
   "// scope may span several blocks, which is why they are two relations. c1 label exists\n"
   "// because TypeScript emitted `outer: for (...)` as the loop and DROPPED the label. Every\n"
   "// block form gets a row including the ones that produce no other output: TS's enum audit\n"
   "// found NAMESPACE_BODY and MODULE_BODY emitting no block row at all.",
 "js_type_reference":
   "A node in a JSDoc TYPE EXPRESSION — the JavaScript type system in its entirety, and it lives\n"
   "// in comments. Array<Object<string,number>> is three rows with c2 parentReferenceLinkHash.\n"
   "// c14 isTypeOnly is ALWAYS true and no call-graph rule may traverse this relation. c1\n"
   "// admits UNKNOWN_SYNTAX deliberately: JSDoc type syntax is not standardised (Closure,\n"
   "// TypeScript and jsdoc.app differ), so an undecomposable expression gets one row with its\n"
   "// text preserved rather than a guess or a dropped tag. Depth cap 32; max measured 67.",
 "js_comment":
   "A comment, JSDoc block, or directive. c5 declaresType marks a comment that IS a declaration\n"
   "// (@typedef/@callback), which is what makes js_type.evidenceKind = COMMENT_ONLY checkable.\n"
   "// c6 directiveKind carries USE_STRICT, which decides the enclosing scope's strictness and\n"
   "// therefore whether an undeclared assignment binds a global or throws.",
 "js_parse_gap":
   "One row per construct the parser could not handle. RECORDS the gap, never rewrites source.\n"
   "// An always-empty relation that suddenly has rows is a signal; a missing relation is a\n"
   "// silence. On one large project a nested config silently excluded 1,270 of 1,821 files\n"
   "// because nothing counted them.",
 "js_package_entry":
   "What a package EXPOSES: one row per (specifier, condition) its package.json publishes --\n"
   "// `main` (with the index.js fallback) as specifier=<name> condition=default, and every\n"
   "// `exports` entry: subpaths (`<name>/sub`), patterns kept literal (`<name>/*`), and\n"
   "// conditional targets with the condition path as written (`require`, `import`, `node,import`).\n"
   "// c3 targetFilePath is project-relative like js_module.filePath; c4 links the js_module when\n"
   "// the target was extracted and stays EMPTY when the file does not exist (a named absence,\n"
   "// never a guess). Without this a library IR built on its own could not say what\n"
   "// require('pkg') loads, so it linked to a client only through that client's installed tree.",
}

#: The frozen first cut. Order here is the order in the .dl.
SPINE = ["js_module", "js_scope", "js_type", "js_method", "js_method_parameter",
         "js_variable", "js_import", "js_expression", "js_call_site"]

#: NO lib_js_* relation is EVER staged. OQ-2 is ruled (schema doc 8.1): there is ONE ambient
#: population and it is provenance-tagged, not language-tagged, so a JavaScript call site
#: REFERENCES the existing lib_ts_* rows rather than minting a parallel population. The pairs
#: are declared so every projection keeps its two-rule shape, and that is all.
NOT_STAGED = ["lib_js_module", "lib_js_scope", "lib_js_type", "lib_js_type_heritage",
              "lib_js_method", "lib_js_method_parameter", "lib_js_field", "lib_js_variable",
              "lib_js_import", "lib_js_export", "lib_js_expression", "lib_js_call_site",
              "lib_js_block", "lib_js_type_reference", "lib_js_comment", "lib_js_parse_gap",
              "lib_js_package_entry"]

#: Relations the PARSER never writes, in either provenance. None yet — js_type_heritage
#: and js_call_site have tier-3 COLUMNS, but the parser does write their rows.
ENGINE_ONLY = []


def parse_doc():
    """(relations, errors). A relation is (name, arity), read from schema.json — the
    frozen column list, one array per relation; arity is its length. The markdown
    schema documents were retired; this file is the schema."""
    import json
    schema = json.load(open(DOC))
    rels, errors, seen = [], [], set()
    for name, spec in schema["relations"].items():
        if not name.startswith("js_"):
            errors.append("%s: not a js_ relation" % name)
        if name in seen:
            errors.append("%s: declared twice" % name)
        seen.add(name)
        cols = spec.get("columns", [])
        if not cols:
            errors.append("%s: no columns — arity unverifiable" % name)
        if len(set(cols)) != len(cols):
            errors.append("%s: a column name repeats" % name)
        rels.append((name, len(cols)))
    if not rels:
        errors.append("parsed 0 relations from %s" % DOC)
    for name, _ in rels:
        if name not in DOCS:
            errors.append("%s: no purpose comment in gen_decls.py DOCS" % name)
    for name in DOCS:
        if name not in seen:
            errors.append("%s: has a DOCS comment but no entry in schema.json" % name)
    for name in SPINE:
        if name not in seen:
            errors.append("%s: listed in SPINE but absent from schema.json" % name)
    return rels, errors


def decl(name, arity):
    cols = ",".join("c%d:symbol" % i for i in range(arity))
    return ".decl %s(%s)" % (name, cols)


def render(rels):
    by_name = dict(rels)
    out = ['''// ============================================================================
// Base input relations — JAVASCRIPT parser IR. One relation pair per entity kind.
//
// GENERATED FROM schema.json BY gen_decls.py — DO NOT HAND-EDIT.
// Re-run `python3 gen_decls.py --check` in CI; drift here is a silent schema break.
//
// NAMING: one prefix per core language; `lib_` is the EXTERNAL marker on top of it.
//
//     js_<entity>       JavaScript under analysis      <- the PARSER emits only these
//     lib_js_<entity>   external / third-party         <- the ENGINE stages these
//
// COLUMN ORDER IS THE CONTRACT. All columns are `symbol`. New columns append ONLY.
// The last column is the entity's own unique hash for every relation EXCEPT
// js_expression, which has one column appended AFTER its hash (c32,
// introducesDeclarationLinkHash) because the schema was already frozen and appending
// is the only safe edit. So a check that locates a primary key BY POSITION is wrong
// for js_expression and must locate it by name. Column NAMES live only in the schema
// doc, so a rename is free after the freeze and a reorder is not.
//
// FIVE THINGS AN ENGINE AUTHOR MUST READ BEFORE JOINING ANYTHING:
//
//  1. THE MODULE GRAPH LIVES IN THE EXPRESSION RELATION. 83.6% of module edges are
//     expression-borne: require() is a call, module.exports = X is an assignment.
//     js_import/js_export rows are MINTED FROM js_expression in a second pass, and
//     js_import.edgeBearer partitions the table (2,300 files wholly EXPRESSION, 431
//     wholly DECLARATION, 0 mixed). 13.6% of require() calls are not even top-level.
//
//  2. THE PARSER RESOLVES NOTHING ACROSS FILES, AND CANNOT. The oracle itself —
//     tsc with checkJs — decides only 52.6% of call sites, because JavaScript types
//     are inferred, not declared (0.165% syntactic annotations). resolvedMethodLinkHash
//     and resolvedTypeLinkHash are TIER 3 and stay empty. What every row DOES carry is
//     the name as written, the import hop, and resolvedFilePath. That is the contract.
//
//  3. TYPES LIVE IN COMMENTS. 36.4% of parameters are typed by JSDoc and 0.165% by
//     syntax. js_type_reference is a TREE parsed out of comment text, isTypeOnly is
//     always true there, and 677 js_type rows have evidenceKind = COMMENT_ONLY —
//     declarations whose only evidence is a comment. None may reach the call graph.
//
//  4. NO lib_js_* ROW IS EVER STAGED. There is ONE ambient population and it is
//     provenance-tagged, not language-tagged: a lib row describes a declaration read
//     from a .d.ts, and whether a JavaScript or TypeScript call site references it is a
//     property of the CALL SITE -- but the parser stages NO pointer to one, because a
//     pointer to a specific lib row IS a resolved link and tier 3 forbids it. The row
//     carries the target NAME AS WRITTEN plus resolutionOutcome =
//     AMBIENT_BUILTIN_TARGET, and the ENGINE joins. This matters more than it sounds:
//     24.4% of all resolution declines are calls whose receiver is a Node builtin with
//     no ambient declarations.
//
//  5. HOISTING IS TWO COLUMNS, NOT ONE. js_variable.declarationScopeLinkHash is where
//     a name is VISIBLE FROM; syntacticScopeLinkHash is where it is WRITTEN. They
//     differ for every `var` in a block. js_scope is a real relation with a parent FK
//     because the binder, not the type system, is what resolves a name here.
//
// NOT STAGED (declared for symmetry only — library IR is declarations, not bodies):
//   @NOT_STAGED@
// ============================================================================'''
           .replace("@NOT_STAGED@", ", ".join(NOT_STAGED))]

    def block(title, names):
        out.append("")
        out.append("// " + "=" * 74)
        out.append("// " + title)
        out.append("// " + "=" * 74)
        for n in names:
            arity = by_name[n]
            out.append("")
            out.append("// " + DOCS[n])
            out.append("// (%d columns)" % arity)
            out.append(decl(n, arity))
            out.append(decl("lib_" + n, arity))

    block("SPINE — the frozen first cut. Enough to build a call graph.", SPINE)
    rest = [n for n, _ in rels if n not in SPINE]
    block("SECOND FREEZE — declared now so the column contract is fixed.", rest)
    out.append("")
    return "\n".join(out)


def main():
    check = "--check" in sys.argv
    rels, errors = parse_doc()
    if errors:
        print("SCHEMA DOC ERRORS — refusing to generate:")
        for e in errors:
            print("  " + e)
        return 2
    text = render(rels)
    total = sum(a for _, a in rels)
    spine = sum(a for n, a in rels if n in SPINE)
    if check:
        have = open(OUT).read() if os.path.exists(OUT) else ""
        if have != text:
            print("DRIFT: %s does not match %s" % (os.path.basename(OUT), os.path.basename(DOC)))
            import difflib
            for line in list(difflib.unified_diff(
                    have.split("\n"), text.split("\n"),
                    fromfile="decls_base_js.dl (on disk)",
                    tofile="decls_base_js.dl (from schema.json)", lineterm=""))[:40]:
                print("  " + line)
            print("  Fix: python3 src/schema/javascript/gen_decls.py")
            return 1
        print("OK  %d relation pairs, %d columns (spine %d) — .dl matches schema.json"
              % (len(rels), total, spine))
        return 0
    open(OUT, "w").write(text)
    print("wrote %s — %d relation pairs, %d columns (spine %d)"
          % (os.path.basename(OUT), len(rels), total, spine))
    return 0


if __name__ == "__main__":
    sys.exit(main())
