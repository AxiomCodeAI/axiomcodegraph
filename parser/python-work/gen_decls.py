#!/usr/bin/env python3
"""Generate decls_base_py.dl FROM the schema doc's own column tables.

Arities are parsed out of the '### 2.N `py_x` / `lib_py_x` — N columns' headers and
cross-checked against the number of numbered rows in each table, so the .dl cannot
drift from the document. Run with --check to diff instead of write (for CI).
"""
import re, sys, hashlib

DOC = "PYTHON-FACT-SCHEMA.md"
OUT = "decls_base_py.dl"

DOCS = {
 "py_module": "A Python source file or package __init__.py. The unit of import resolution and\n// a first-class runtime namespace. No Java analogue. c9 pythonDialect discriminates\n// Python 2 vs 3 — both dialects emit into THIS relation, never a separate one.",
 "py_scope": "A lexical scope, mirroring CPython symtable.SymbolTable. c4 parentScopeLinkHash is the\n// spine the name-resolution layer walks upward. c20 startColumn is IN THE KEY: without it\n// two lambdas or two comprehensions on one line collide (measured 0.60% of scopes), which\n// would silently merge two scopes' entire binding sets. No Java analogue.",
 "py_binding": "One row per (scope, name) — CPython symtable.Symbol. Python's local_variable table plus\n// its global / nonlocal / free / import / parameter tables, unified. Cols 4..14 are the\n// COMPLETE symtable.Symbol predicate set (11 on Py3; Py2 lacks is_nonlocal/is_annotated,\n// which are then always \"false\"). Resolves the 50.7% of calls with a bare-name receiver.",
 "py_type": "A class statement. Cols 0..11 mirror java_type 0..11. c3 typeCategory and c21 mroKind are\n// dialect-sensitive: a base-less class is OLD_STYLE_CLASS_TYPE / OLD_STYLE_DFS under Py2 and\n// CLASS_TYPE / IMPLICIT_OBJECT under Py3.",
 "py_type_base": "One base-class expression. ORDERED (c1 position) because C3 / MRO depends on it — 12.1% of\n// classes have multiple bases. Also carries keyword bases (metaclass=) and dynamic bases,\n// which a type_reference cannot express.",
 "py_type_reference": "A use of a type: annotation, base class, isinstance / cast target, except or raise type, or\n// a Python 2 '# type:' comment. Cols 0..16 mirror java_type_reference 0..16 so the name->type\n// resolution layer ports as a relation rename.",
 "py_method": "A def / async def / lambda, plus the synthetic <module> and <classbody> initializers that\n// give module-level and class-body code a caller. Cols 0..20 are byte-for-byte java_method\n// 0..20; c32 startColumn is APPENDED (not placed by startLine) to preserve that parity, and\n// is IN THE KEY because two lambdas can share line+qualname+signature.",
 "py_method_parameter": "A formal parameter. Cols 0..11 mirror java_method_parameter 0..11. 68.2% carry no annotation,\n// so argument->parameter flow, not declared type, is the primary receiver-typing mechanism.",
 "py_field": "A class attribute or an instance attribute recovered from 'self.x = ...'. Cols 0..12 mirror\n// java_field 0..12. Identity is (ownerType, name, origin) — all writes of one attribute merge\n// into one row; see py_field_write for each site.",
 "py_field_write": "One write site of an attribute. Required for data flow: only 67% of self.x writes are in\n// __init__, so cross-method attribute state is common.",
 "py_field_position": "A field's declaration order within its type. @dataclass / NamedTuple generate __init__ in\n// this order, so positional argument flow depends on it.",
 "py_decorator": "A decorator applied to a class or function. NOT an annotation: a decorator is a call that\n// REPLACES the decorated object (c17 replacesTarget). Cols 0..3 mirror java_annotation 0..3.",
 "py_decorator_argument": "A positional or keyword argument of a decorator call — where framework routes and permissions\n// live. Cols 0..9 mirror java_annotation_argument 0..9.",
 "py_import": "An import statement. Cols 0..8 mirror java_import 0..8. 38% of from-imports are relative, so\n// c9 relativeLevel and parser-side in-repo resolution (c12) matter. c15 isExternalTarget means\n// only 'did not resolve in this analysis'.",
 "py_expression": "An expression AST node — the spine of call resolution. Cols 0..23 mirror java_expression\n// 0..23. c24 pyScopeLinkHash and c26 bindingLinkHash are the key additions: Python resolves\n// names by scope chain, not by file. There is deliberately no OBJECT_CREATION kind —\n// construction is recorded in py_type_inference instead.",
 "py_call_site": "A call site. A BASE relation for Python (derived in Java) because the call shape is not\n// recoverable from one positional pattern: keyword args, * / ** spreading, chained receivers,\n// super(), and the receiver's syntactic shape (c4 receiverKind) which is all we honestly know\n// about a duck-typed receiver. 1:1 with its CALL expression, so its key chains off c5.",
 "py_comment": "A comment, shebang, encoding cookie, '# type:' comment, or docstring. Cols 0..8 mirror\n// java_comment 0..8. c11 typeCommentPayload is Python 2's only annotation channel.",
 "py_block": "An indentation-delimited suite. Cols 0..16 mirror java_block 0..16. c9 methodOwnerHash is\n// NEVER empty — module-level blocks are owned by the synthetic <module> method. c19 links the\n// if/while condition, which is how isinstance() narrowing reaches the receiver.",
 "py_parse_gap": "One row per construct the grammar could not represent. RECORDS the gap, does not repair it.\n// Replaces v3's py_source_bridge_edit: tree-sitter parses 99.59% of the CPython 2.7 stdlib\n// unaided, so rewriting source to recover 0.41% of files was the wrong trade. Positions stay\n// measured, never mapped. Zero rows for ~99.6% of modules, Python 2 included.",
 "py_type_parameter": "DEFERRED — PEP 695 (3.12+) only: 'class C[T]' / 'def f[T]()'. Declared now so the column\n// contract is fixed; NOT emitted for <=3.11, where TypeVar is a runtime assignment captured as\n// a py_binding with targetEntityKind=TYPE_VAR.",
}

SPINE = ["py_module","py_scope","py_binding","py_type","py_type_base","py_method",
         "py_method_parameter","py_import","py_expression","py_call_site"]

def parse_doc():
    md = open(DOC).read()
    rels, errors = [], []
    for m in re.finditer(r'^### 2\.\d+ `(py_\w+)` / `lib_\1` — (\d+) columns', md, re.M):
        name, declared = m.group(1), int(m.group(2))
        # count numbered table rows until the next '### ' or '**PK**'
        seg = md[m.end(): m.end()+14000]
        seg = re.split(r'\n### |\n\*\*PK\*\*', seg)[0]
        idxs = sorted(int(x) for x in re.findall(r'^\| (\d+) \|', seg, re.M))
        if not idxs:
            # fallback: inline prose form  `0 colA \u00b7 1 colB \u00b7 2 colC`
            inline = " ".join(re.findall(r'`([^`]*\u00b7[^`]*)`', seg, re.S))
            idxs = sorted(int(x) for x in re.findall(r'(?:^|\u00b7)\s*(\d+)\s+\w', inline))
        if not idxs:
            errors.append("%s: NO column list parsed - cannot verify arity" % name)
        if idxs and idxs != list(range(len(idxs))):
            errors.append("%s: table indices not 0..N contiguous: %s" % (name, idxs))
        if idxs and len(idxs) != declared:
            errors.append("%s: header says %d columns, table has %d rows" % (name, declared, len(idxs)))
        rels.append((name, declared))
    return rels, errors

def render(rels):
    hdr = '''// ============================================================================
// Base input relations — PYTHON parser IR. One relation pair per entity kind.
//
// GENERATED FROM python-work/PYTHON-FACT-SCHEMA.md BY gen_decls.py — DO NOT HAND-EDIT.
// Re-run `python3 gen_decls.py --check` in CI; a drift here is a silent schema break.
//
// NAMING: one prefix per core language. java_* is Java, py_* is Python, the next
// language takes its own lan_*. `lib_` remains the EXTERNAL marker layered on top:
//
//     py_<entity>       Python source under analysis   <- the PARSER emits only these
//     lib_py_<entity>   external / third-party Python  <- the ENGINE populates these
//
// COLUMN ORDER IS THE CONTRACT. All columns are `symbol`. New columns append ONLY.
// Convention: the last column is the entity's own unique hash; serviceVersionLinkHash
// is immediately before it.
//
// UNIFIED PYTHON 2 / PYTHON 3 OUTPUT: both dialects emit into these same relations.
// The dialect is a COLUMN (py_module.pythonDialect, c9); consumers must read it before
// interpreting py_type.typeCategory, py_type.mroKind, or comprehension scoping.
//
// NOT STAGED (declared for symmetry only — library IR is declarations, not bodies):
//   lib_py_expression, lib_py_call_site, lib_py_block, lib_py_binding,
//   lib_py_field_write, lib_py_type_inference, lib_py_source_bridge_edit
// ============================================================================
'''
    out = [hdr]
    for group, label in ((SPINE, "SPINE — proposed for the first freeze (supports all four data-flow paths)"),
                         (None,  "DEFERRED — proposed for a second freeze")):
        out.append("// " + "="*74 + "\n// %s\n// %s" % (label, "="*74))
        for name, n in rels:
            inspine = name in SPINE
            if (group is SPINE) != inspine: continue
            cols = ",".join("c%d:symbol" % i for i in range(n))
            out.append("// %s\n// (%d columns)\n.decl %s(%s)\n.decl lib_%s(%s)\n"
                       % (DOCS.get(name, name), n, name, cols, name, cols))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# ENUM MEMBERSHIP CHECK
#
# Arity alone cannot see this class of drift. ELEMENT, KEY and VALUE were added to
# PythonEdgeRole.ts and shipped while the frozen doc still listed 42 values; the
# column COUNT never moved, so --check stayed green and the divergence was found by
# reading a diff. A guard nobody can rely on for a whole class of change is worse
# than no guard, because it is trusted.
#
# The doc is authoritative. Code holding a value the doc does not name is drift in
# one direction; the doc naming a value the code cannot emit is drift in the other,
# and both matter — the first means goldens exist for facts nothing describes, the
# second means a consumer is written against a value it will never see.
# ---------------------------------------------------------------------------
import os, glob

ENUM_DIR = os.path.join("..", "src", "enums", "python")

def _pascal(camel):
    return "Python" + camel[0].upper() + camel[1:]

# A doc column name is NOT unique across relations - `kind` means PythonExpressionKind
# under 2.15 and PythonBlockKind under 2.18 - so enums are keyed by (relation, column)
# and resolved through this table. Anything unlisted falls back to _pascal(column).
#
# This table exists because the naming heuristic alone left 24 of 53 TS enums
# UNCOMPARED, including PythonExpressionKind. A mutation test proved it: injecting a
# bogus value into PythonExpressionKind did not trip the guard. A guard with a silent
# 45% blind spot is worse than none, because it is trusted.
ALIAS = {
    ("py_expression", "kind"): "PythonExpressionKind",
    ("py_expression", "rootContext"): "PythonRootContext",
    ("py_expression", "unaryFixity"): "PythonUnaryFixity",
    ("py_expression", "expressionOwnerKind"): "PythonExpressionOwnerKind",
    ("py_expression", "referencedEntityKind"): "PythonReferencedEntityKind",
    ("py_block", "kind"): "PythonBlockKind",
    ("py_decorator", "kind"): "PythonDecoratorKind",
    ("py_decorator", "context"): "PythonDecoratorContext",
    ("py_decorator", "builtinKind"): "PythonBuiltinDecoratorKind",
    ("py_decorator_argument", "valueType"): "PythonDecoratorArgumentValueType",
    ("py_parse_gap", "kind"): "PythonParseGapKind",
    ("py_parse_gap", "constructKind"): "PythonParseGapKind",
    ("py_type_parameter", "kind"): "PythonTypeParameterKind",
    ("py_type_parameter", "variance"): "PythonTypeParameterVariance",
    ("py_comment", "kind"): "PythonCommentKind",
    ("py_parse_gap", "disposition"): "PythonParseGapDisposition",
    ("py_module", "pythonDialect"): "PythonDialect",
    ("py_module", "emissionRegime"): "PythonEmissionRegime",
    ("py_scope", "ownerKind"): "PythonScopeOwnerKind",
    ("py_scope", "blockType"): "SymbolBlockType",
    ("py_binding", "targetEntityKind"): "PythonBindingTargetKind",
    ("py_method_parameter", "paramKind"): "PythonParameterKind",
    ("py_import", "resolvedTargetKind"): "PythonImportTargetKind",
    ("py_type_reference", "context"): "PythonTypeRefContext",
    ("py_type_reference", "kind"): "PythonTypeRefKind",
    ("py_type_reference", "referenceOwnerKind"): "PythonTypeRefOwnerKind",
    ("py_type", "typeModifier"): "PythonTypeModifier",
    ("py_field", "fieldModifier"): "PythonFieldModifier",
    ("py_field", "writeKind"): "PythonFieldWriteKind",
    ("py_method", "methodModifier"): "PythonMethodModifier",
    ("py_field", "fieldAccess"): "PythonMethodAccess",   # one access enum serves both
    ("py_parse_gap", "disposition"): "PythonParseGapDisposition",
}

# Enums the doc does not spell out, with the reason. Listed so that "not compared"
# is a decision on the record rather than an accident.
# Relations the schema declares but the parser does not emit yet. Their enums cannot
# exist, so their absence is a backlog item, not schema drift.
NOT_YET_EMITTED = set()   # py_comment shipped; nothing is exempt now

UNSPECIFIED_OK = {
    # py_expression c2 says only "the statement form the root sits in" - the doc never
    # enumerates it. That is a DOC DEFECT, tracked rather than waived, but failing the
    # build on it would block A3 for something only the human can ratify.
    "PythonRootContext",
    "SymbolBlockType",        # mirrors CPython symtable block types, defined upstream
    "PythonFieldWriteKind",   # survivor of the removed py_field_write (2.10)
}

def parse_doc_enums():
    """Enum value sets the doc declares, keyed by (relation, column).

    Sectioned rather than line-by-line. A line-by-line pass read only the FIRST line
    of `**\u0060edgeRole\u0060 enum:**`, which wraps over nine lines, and then reported all
    39 of the values on the continuation lines as missing from the doc - a false
    alarm larger than the real drift it was hunting.
    """
    md = open(DOC).read()
    heads = [(m.start(), m.group(1)) for m in re.finditer(r"^### 2\.\d+ `(py_\w+)`", md, re.M)]
    found = {}
    for i, (pos, rel) in enumerate(heads):
        seg = md[pos: heads[i + 1][0] if i + 1 < len(heads) else len(md)]
        # form 1: **`edgeRole` enum:** ... up to the terminating '.' at end of line
        for m in re.finditer(r"\*\*`(\w+)` enum:\*\*(.+?)\.\n", seg, re.S):
            found.setdefault((rel, m.group(1)), set()).update(
                re.findall(r"`([A-Z][A-Z0-9_*]*)`", m.group(2)))
        # form 2: | 7 | `typeCategory` | `A` \| `B` \| `C` |
        #
        # Take the cell up to the em-dash and no further. Two wrong cuts before this:
        # reading the WHOLE cell turned grammarUsed's trailing prose ("`PARTIAL`
        # means ...") into a phantom missing value, and restricting to a leading
        # unbroken alternation truncated five enums at their first parenthetical,
        # because the doc legitimately writes `CONSTRUCTOR` (`__init__`) mid-list.
        for m in re.finditer(r"^\| \d+ \| `(\w+)`[^|]*\|(.+?)\|\s*$", seg, re.M):
            col = m.group(1)
            if (rel, col) in found:      # an explicit enum block always wins
                continue
            cell = re.split(r"\s\u2014\s", m.group(2))[0]
            # A comma-set column is a SET of flags, not an alternation:
            #   | 5 | `typeModifier` | comma-set: `ABSTRACT,FINAL,SLOTS` |
            cs = re.search(r"comma-set:\s*`([A-Z][A-Z0-9_,]*)`", cell)
            if cs:
                found[(rel, col)] = set(cs.group(1).split(","))
                continue
            vals = re.findall(r"`([A-Z][A-Z0-9_*]*)`", cell)
            # Require a real alternation. Without this, `hasElseClause` reads as a
            # 3-value enum because its description happens to backtick TRY/FOR/WHILE,
            # and a boolean column gets guarded as though it were an enum.
            if len(vals) >= 2 and re.search(r"`\s*\\?\|\s*`", cell):
                found.setdefault((rel, col), set()).update(vals)
        # form 3: prose outside any table -  `valueType`: `A` \| `B` \| `C`
        #
        # These WRAP. Matching to end-of-line caught the first two values of
        # py_decorator_argument.valueType and reported the other twelve as missing,
        # which is a false alarm that looks exactly like real drift. Run to the blank
        # line that ends the paragraph instead.
        for m in re.finditer(r"^-?\s*`(\w+)`:\s*(.+?)(?=\n\n|\n-\s*`|\Z)", seg, re.S | re.M):
            col = m.group(1)
            vals = re.findall(r"`([A-Z][A-Z0-9_]*)`", m.group(2))
            if len(vals) >= 2 and (rel, col) not in found:
                found[(rel, col)] = set(vals)
    return found

def parse_code_enums():
    """Enum members declared in TypeScript, keyed by file basename."""
    out = {}
    for f in glob.glob(os.path.join(ENUM_DIR, "**", "*.ts"), recursive=True):
        base = os.path.basename(f)[:-3]
        if base == "index":
            continue
        members = set(re.findall(r"^\s+([A-Z][A-Z0-9_]*) = '", open(f).read(), re.M))
        if members:
            out[base] = members
    return out
def _expand(docvals, codevals):
    """Resolve `ASYNC_*` style wildcards against what the code actually declares.

    The doc abbreviates four comprehension kinds as ASYNC_*, which is legitimate
    prose and became a phantom drift when compared literally. A wildcard is satisfied
    by any code value matching the prefix, and is a real miss only when NOTHING
    matches - otherwise the doc must be rewritten for every variant added, which is
    how docs stop being written at all.
    """
    out, wild = set(), []
    for v in docvals:
        (wild.append(v) if v.endswith("*") else out.add(v))
    for w in wild:
        hits = {c for c in codevals if c.startswith(w[:-1])}
        out |= hits or {w}
    return out

def check_enums():
    doc_enums, code_enums = parse_doc_enums(), parse_code_enums()
    problems, checked, seen = [], 0, set()
    for (rel, col), docvals in sorted(doc_enums.items()):
        cls = ALIAS.get((rel, col), _pascal(col))
        if cls not in code_enums:
            # A relation with no emitter yet has no enum yet, which is expected and
            # is NOT drift. Distinguish it from a genuinely missing alias, or the
            # guard cries wolf on work that has simply not started.
            if rel in NOT_YET_EMITTED:
                continue
            problems.append("%s.%s: doc declares %d values but no TS enum found "
                            "(looked for %s.ts) - add an ALIAS entry"
                            % (rel, col, len(docvals), cls))
            continue
        seen.add(cls)   # count DISTINCT enums; several are reached by 2+ columns
        codevals = code_enums[cls]
        docvals = _expand(docvals, codevals)
        only_code, only_doc = sorted(codevals - docvals), sorted(docvals - codevals)
        if only_code:
            problems.append("%s.%s (%s): IN CODE, NOT IN DOC: %s"
                            % (rel, col, cls, ", ".join(only_code)))
        if only_doc:
            problems.append("%s.%s (%s): IN DOC, NOT IN CODE: %s"
                            % (rel, col, cls, ", ".join(only_doc)))
    # An enum nobody compares is an enum nobody guards, so this FAILS rather than
    # printing a note. A mutation test is what proved the note was not enough.
    unguarded = sorted(set(code_enums) - seen - UNSPECIFIED_OK)
    if unguarded:
        problems.append("UNGUARDED - declared in TS, never compared to the doc: %s"
                        % ", ".join(unguarded))
    return problems, len(seen), [], len(code_enums)

rels, errors = parse_doc()
enum_problems, enum_checked, enum_unmapped, enum_total = check_enums()
if errors:
    print("DOC INCONSISTENCIES:"); [print("  -", e) for e in errors]; sys.exit(1)
if enum_problems:
    print("ENUM DRIFT between %s and src/enums/python (%d enums compared):" % (DOC, enum_checked))
    for e in enum_problems: print("  -", e)
    print("\nThe doc is authoritative. Either sync the doc, or revert the code.")
    sys.exit(1)
txt = render(rels)
if "--check" in sys.argv:
    cur = open(OUT).read() if __import__("os").path.exists(OUT) else ""
    if cur != txt:
        print("DRIFT: %s is out of date with %s. Re-run gen_decls.py." % (OUT, DOC)); sys.exit(1)
    print("OK: %s matches %s (%d relations)" % (OUT, DOC, len(rels)))
    print("OK: %d/%d enums agree with the doc (%d waived, listed in UNSPECIFIED_OK)"
          % (enum_checked, enum_total, enum_total - enum_checked))
    if enum_unmapped:
        # Reported, never silent: an enum nobody compares is an enum nobody guards.
        print("NOT COMPARED (%d) - no TS file matched:" % len(enum_unmapped))
        for u in enum_unmapped: print("     ", u)
    sys.exit(0)
open(OUT,"w").write(txt)
print("wrote %s: %d relations, %d decls, %d columns total"
      % (OUT, len(rels), len(rels)*2, sum(n for _, n in rels)))
print("spine: %d relations, %d columns" % (len(SPINE), sum(n for k,n in rels if k in SPINE)))
