#!/usr/bin/env python3
"""Generate decls_base_ts.dl FROM the schema doc's own column tables.

Arities come out of the '### 4.N `ts_x` / `lib_ts_x` — N columns' headers and are
cross-checked against the numbered rows of each table, so the .dl cannot drift from
the document. Run with --check to diff instead of write (for CI).

Why generated: a hand-maintained .dl drifts silently. Column ORDER is the contract
with the Souffle engine, and the .dl carries only c0..cN — so a column rename is free
post-freeze and a reorder is not. Generating it is what makes that asymmetry safe.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.join(HERE, "TYPESCRIPT-FACT-SCHEMA.md")
OUT = os.path.join(HERE, "decls_base_ts.dl")

#: One-line-plus purpose per relation. Kept HERE rather than in the doc because the
#: .dl is what an engine author reads first, and it must stand alone.
DOCS = {
 "ts_module":
   "A .ts/.tsx/.d.ts file, OR an ambient `declare module \"x\"`, OR `declare global`.\n"
   "// The unit of import resolution AND the symbol merge table (c12 mergeTableKey), which is\n"
   "// why it is a relation at all: Java's package is implicit in a qualified name, a TypeScript\n"
   "// module is not. c16 emissionRegime is a COARSE token (ts6-inproc) and is IN THE KEY — a\n"
   "// version string there would cascade every child hash on a patch bump.",
 "ts_type":
   "A type DECLARATION — class / interface / enum / type alias / namespace. Cols 0..11 mirror\n"
   "// java_type 0..11. Anonymous structural types are NOT here (21,956 function types measured):\n"
   "// only declarations, which is what keeps this relation key-able. c15 declarationGroupKey is\n"
   "// the MERGED entity and is deliberately NOT UNIQUE — one interface name, N declarations, one\n"
   "// type (max 43 measured). Group on c15; key on the last column. c20 isTypeOnly is true for\n"
   "// INTERFACE_TYPE and TYPE_ALIAS_TYPE: no call-graph rule may traverse those rows.",
 "ts_type_heritage":
   "One `extends` / `implements` clause entry, ORDERED (c2 position). c7 inheritsMembers is the\n"
   "// column Java does not need: `extends` inherits members, `implements` asserts and inherits\n"
   "// NOTHING, and 60.4% of classes declare no implements at all. Walking an IMPLEMENTS_CLAUSE\n"
   "// row as a subtyping edge is correct in Java and WRONG here — see ts_type_satisfies.",
 "ts_type_parameter":
   "A generic type parameter. Cols 0..6 mirror java_type_parameter 0..6. ONE relation where Java\n"
   "// has two, because TypeScript attaches type parameters to seven owner kinds (c7 ownerKind).\n"
   "// c13 varianceAnnotation is in/out (TS 4.7, 562 measured); c14 isConst is TS 5.0 (87).",
 "ts_type_reference":
   "The TYPE-NODE TREE. Cols 0..16 mirror java_type_reference 0..16, so the whole name->type\n"
   "// resolution layer ports as a rename. Every type-level construct lives here and NOWHERE\n"
   "// else — conditional, mapped, template-literal, infer, keyof, typeof, indexed-access\n"
   "// (10,436 nodes measured) — which is the structural guarantee that they cannot reach the\n"
   "// call graph. A union is N ROWS with c5 parentReferenceHash, not one row with a list:\n"
   "// max arity measured is 208. c6 position is SOURCE order; the checker reorders and\n"
   "// normalises boolean to true|false, so never compare against checker members.",
 "ts_method":
   "Every function-shaped declaration: function, method, constructor, accessor, arrow, function\n"
   "// expression, static block, AND every bodiless signature. Cols 0..20 are byte-for-byte\n"
   "// java_method 0..20. c25 signatureRole and c27 bodyPresence carry what Java never needs:\n"
   "// 11,599 overload signatures measured, and 44.3% of resolved call targets are BODILESS, so\n"
   "// a target must never be read as an implementation without checking c27. c39 startColumn is\n"
   "// IN THE KEY: 703 arrow functions, and two on one line share name, signature and line.\n"
   "// c7, like ts_field c8, is the owning type OR SHAPE — a ts_type_reference for a\n"
   "// TYPE_LITERAL_*, FUNCTION_TYPE_SIGNATURE or CONSTRUCTOR_TYPE_SIGNATURE row.",
 "ts_method_parameter":
   "A formal parameter. Cols 0..11 mirror java_method_parameter 0..11. 85.3% carry an annotation\n"
   "// (99.998% in ambient code), the inverse of Python's 31.8%, which is why declared-type\n"
   "// receiver typing is the primary mechanism here. c13 isOptional changes ARITY MATCHING, and\n"
   "// c17 isParameterProperty means this parameter also DECLARES A FIELD (c19 links it).",
 "ts_field":
   "A class property, interface property signature, index signature, auto-accessor, parameter\n"
   "// property, or object-literal property. Cols 0..12 mirror java_field 0..12, and the key\n"
   "// chains off c8 tsTypeLinkHash exactly as FieldRegistry chains off typeRegistryLinkHash —\n"
   "// never off a re-derived qualified name. c8 is the owning type OR SHAPE: it points at a\n"
   "// ts_type_reference row when memberKind is a TYPE_LITERAL_* value, because an anonymous\n"
   "// { foo(): string } has members and no declaration to own them (schema 4.8.1). PK prefixes\n"
   "// differ, so a rule joining c8 against ts_type finds NO MATCH for a shape member rather than\n"
   "// a wrong one. c15 isOptional is load-bearing for structural satisfaction: an absent\n"
   "// optional member does not break assignability.",
 "ts_field_position":
   "A field's declaration order within its type. Parity with java_field_position.",
 "ts_enum_member":
   "An enum member. Cols 0..11 mirror java_enum_constant 0..11. c12 valueKind admits COMPUTED\n"
   "// (the value is not always statically known) and c14 isConstEnumMember marks a member that\n"
   "// is INLINED at use sites, so a reference to it may have no runtime target.",
 "ts_variable":
   "A variable declaration, at module, function, block or global scope. Cols 0..8 mirror\n"
   "// java_local_variable 0..8, widened because a module-level const is a first-class\n"
   "// declaration here. c19 boundFunctionLinkHash is the link that makes `const f = () => {}`\n"
   "// callable: 161 resolved call targets were arrow functions.\n"
   "// There is deliberately NO ts_scope relation — measured, 34,798 identifier references and\n"
   "// the ts_block -> ts_method -> ts_type -> ts_module chain reaches every one of them.",
 "ts_import":
   "An import. Cols 0..8 mirror java_import 0..8 with two slots repurposed: c6 isStatic ->\n"
   "// isTypeOnly, c7 isOnDemand -> isWildcard (the projection stays import_wildcard). 45.6% of\n"
   "// ecosystem imports are type-only, so c6 is a first-class column, not a flag. c14/c15 are\n"
   "// filled by ts.resolveModuleName, which needs NO Program and is therefore parser-legal.\n"
   "// One declaration with N named specifiers emits N ROWS: each binds a name and each may be\n"
   "// individually type-only.",
 "ts_export":
   "An export or re-export. NO JAVA ANALOGUE — Java visibility is a modifier and there is no\n"
   "// re-export, but here a re-export chain is the only path from an importer to the real\n"
   "// declaration (1,251 export declarations, 86 `export *` measured). c2 EXPORT_STAR exports a\n"
   "// set this row cannot name; the engine expands it from the source module's exports.",
 "ts_expression":
   "An expression AST node — the spine of call resolution. Cols 0..24 are byte-for-byte\n"
   "// java_expression 0..24, so expr_kind / expr_child / expr_owner port as renames. c16 is\n"
   "// WIDENED from Java: it is the declaration this expression INTRODUCES, discriminated by c0 —\n"
   "// ts_type for CLASS_EXPRESSION, ts_method for ARROW_FUNCTION / FUNCTION_EXPRESSION. Without\n"
   "// that an IIFE's target is reachable only by matching positions, which is what Java's own\n"
   "// extractor does for lambdas and what a fact schema exists to prevent. c27\n"
   "// assertedTypeReferenceLinkHash is the ONLY expression->type edge (`as` / `satisfies`), and\n"
   "// it is a TYPE FK, so no call-graph rule can cross it. c28 isSpread marks where positional\n"
   "// argument flow is PROVABLY imprecise rather than silently wrong.",
 "ts_call_site":
   "A call site — 1:1 with its CALL / NEW / TAGGED_TEMPLATE expression, so the key is a pure\n"
   "// chain off c5. This is where the flagship gate lives: 100% of measured call sites have a\n"
   "// getResolvedSignature answer, and 77.6% of overloaded calls resolve to a NON-FIRST\n"
   "// declaration — so c12 points at ONE SIGNATURE, never at a name. c14 resolvedTargetKind\n"
   "// admits SYNTHESIZED_NO_DECLARATION (2.3% measured: implicit constructors) as an honest\n"
   "// terminal. c19 isTypeOnlyTarget must ALWAYS be false; a true row is a parser bug.",
 "ts_block":
   "A statement block. Cols 0..17 mirror java_block 0..17. Needed for caller attribution, as in\n"
   "// Java, AND as the lexical scope of a let/const, which is what lets ts_variable do without a\n"
   "// scope relation. c13 caughtExceptionTypes is near-always \"\": a TypeScript catch binding is\n"
   "// unknown and cannot be typed. c17 links the guard, so typeof/instanceof/type-predicate\n"
   "// narrowing (440 predicates measured) reaches the receiver.",
 "ts_comment":
   "A comment, JSDoc block, triple-slash directive, or ts-directive. Cols 0..9 mirror\n"
   "// java_comment 0..9. c11 REFERENCE_* directives are real module edges and also feed\n"
   "// ts_import.",
 "ts_decorator":
   "A decorator. Java's annotation relation, same slot, SHARED annotation_on projection: cols\n"
   "// 0..12 mirror java_annotation. But a decorator is not an annotation — it is an expression\n"
   "// that RUNS and may REPLACE its target (c14, c15). c13 decoratorSystem distinguishes the two\n"
   "// incompatible systems (TC39 standard vs legacy experimental); without it a fact base mixes\n"
   "// two evaluation semantics under one relation.",
 "ts_decorator_argument":
   "A positional or named argument of a decorator call — where framework routes and DI tokens\n"
   "// live. Cols 0..10 mirror java_annotation_argument 0..10.",
 "ts_parse_gap":
   "One row per construct that could not be parsed. RECORDS the gap, never rewrites source.\n"
   "// Measured ZERO rows over 25.9 MB with ts.createSourceFile — which is exactly why it must\n"
   "// exist: an always-empty relation that suddenly has rows is a signal, a missing relation is\n"
   "// a silence.",
 "ts_type_satisfies":
   "Structural satisfaction. DECLARED BUT NEVER STAGED BY THE PARSER: satisfaction needs\n"
   "// isTypeAssignableTo, the parser has no checker, and a parser-emitted row would be a guess\n"
   "// dressed as a fact. The ENGINE derives it from ts_field/ts_method/ts_type_heritage; the\n"
   "// ORACLE adjudicates it. 21.5% of measured assignable pairs exist in NO SYNTAX anywhere and\n"
   "// 15.4% are bidirectional, so c4 direction is required and mutual assignability is NOT\n"
   "// identity. c11 oracleAgreement carries the relation's own error term.",
}

#: The frozen first cut. Order here is the order in the .dl.
SPINE = ["ts_module", "ts_type", "ts_method", "ts_method_parameter", "ts_field",
         "ts_type_reference", "ts_type_heritage", "ts_import", "ts_expression",
         "ts_call_site"]

#: lib_ts_* relations declared for symmetry and intentionally NOT staged: library IR
#: is declarations, not bodies. 1,113 declaration files measured, zero function bodies.
NOT_STAGED = ["lib_ts_expression", "lib_ts_call_site", "lib_ts_block",
              "lib_ts_variable", "lib_ts_parse_gap"]

#: Relations the PARSER never writes, in either provenance.
ENGINE_ONLY = ["ts_type_satisfies"]


def parse_doc():
    """(relations, errors). A relation is (name, arity); errors are drift, not warnings."""
    md = open(DOC).read()
    rels, errors, seen = [], [], set()
    for m in re.finditer(r'^### 4\.\d+ `(ts_\w+)` / `lib_\1` — (\d+) columns', md, re.M):
        name, declared = m.group(1), int(m.group(2))
        if name in seen:
            errors.append("%s: declared twice in the doc" % name)
        seen.add(name)
        seg = re.split(r'\n### |\n\*\*PK\*\*', md[m.end():])[0]
        idxs = [int(x) for x in re.findall(r'^\| (\d+) \|', seg, re.M)]
        if not idxs:
            errors.append("%s: no column table found — arity unverifiable" % name)
        elif idxs != list(range(len(idxs))):
            errors.append("%s: table indices are not 0..N contiguous: %s" % (name, idxs))
        elif len(idxs) != declared:
            errors.append("%s: header says %d columns, table has %d rows"
                          % (name, declared, len(idxs)))
        rels.append((name, declared))
    if not rels:
        errors.append("parsed 0 relations from %s — the header regex no longer matches" % DOC)
    for name, _ in rels:
        if name not in DOCS:
            errors.append("%s: no purpose comment in gen_decls.py DOCS" % name)
    for name in DOCS:
        if name not in seen:
            errors.append("%s: has a DOCS comment but no section in the doc" % name)
    for name in SPINE:
        if name not in seen:
            errors.append("%s: listed in SPINE but absent from the doc" % name)
    return rels, errors


def decl(name, arity):
    cols = ",".join("c%d:symbol" % i for i in range(arity))
    return ".decl %s(%s)" % (name, cols)


def render(rels):
    by_name = dict(rels)
    out = ['''// ============================================================================
// Base input relations — TYPESCRIPT parser IR. One relation pair per entity kind.
//
// GENERATED FROM TYPESCRIPT-FACT-SCHEMA.md BY gen_decls.py — DO NOT HAND-EDIT.
// Re-run `python3 gen_decls.py --check` in CI; drift here is a silent schema break.
//
// NAMING: one prefix per core language; `lib_` is the EXTERNAL marker on top of it.
// java_*/lib_* is PROVENANCE, not language: the project under analysis vs everything
// else. So:
//
//     ts_<entity>       TypeScript under analysis      <- the PARSER emits only these
//     lib_ts_<entity>   external / third-party         <- the ENGINE stages these
//
// COLUMN ORDER IS THE CONTRACT. All columns are `symbol`. New columns append ONLY.
// The last column is always the entity's own unique hash; serviceVersionLinkHash is
// immediately before it. Column NAMES live only in the schema doc, so a rename is
// free after the freeze and a reorder is not.
//
// THREE THINGS AN ENGINE AUTHOR MUST READ BEFORE JOINING ANYTHING:
//
//  1. `name -> single entity` IS FALSE. TypeScript merges declarations: one interface
//     name can have N declarations across N files (max 43 measured) that are ONE type.
//     ts_type/ts_method/ts_field are keyed PER DECLARATION SITE; the merged entity is
//     `declarationGroupKey`, which is deliberately NOT UNIQUE. Group on it. A rule that
//     assumes one row per name is wrong by construction.
//
//  2. INHERITANCE EDGES DO NOT CAPTURE SUBTYPING. TypeScript is structural: 60.4% of
//     classes satisfy their interfaces with no `implements` clause, and 21.5% of
//     assignable pairs appear in no syntax at all. ts_type_heritage.inheritsMembers
//     tells you whether an edge inherits members (`extends`) or merely asserts
//     (`implements`). For subtyping use ts_type_satisfies, which the ENGINE derives.
//
//  3. THE TYPE GRAPH IS NOT THE CALL GRAPH. Type aliases, interfaces, conditional /
//     mapped / template-literal types and `import type` have no runtime existence.
//     They are confined to ts_type_reference and flagged isTypeOnly wherever they can
//     be reached. ts_call_site.isTypeOnlyTarget must always be "false".
//
// NOT STAGED (declared for symmetry only — library IR is declarations, not bodies):
//   @NOT_STAGED@
//
// ENGINE-POPULATED (the parser writes no row, in either provenance):
//   @ENGINE_ONLY@
// ============================================================================'''
           .replace("@NOT_STAGED@", ", ".join(NOT_STAGED))
           .replace("@ENGINE_ONLY@", ", ".join(ENGINE_ONLY))]

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

    block("SPINE — the frozen first cut. Supports all four resolution paths.", SPINE)
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
                    fromfile="decls_base_ts.dl (on disk)",
                    tofile="decls_base_ts.dl (from doc)", lineterm=""))[:40]:
                print("  " + line)
            print("  Fix: python3 src/schema/typescript/gen_decls.py")
            return 1
        print("OK  %d relation pairs, %d columns (spine %d) — .dl matches the doc"
              % (len(rels), total, spine))
        return 0
    open(OUT, "w").write(text)
    print("wrote %s — %d relation pairs, %d columns (spine %d)"
          % (os.path.basename(OUT), len(rels), total, spine))
    return 0


if __name__ == "__main__":
    sys.exit(main())
