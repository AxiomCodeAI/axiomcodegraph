#!/usr/bin/env python3
"""Ground-truth emitter for the Python fact-table oracle.

Runs under the PINNED interpreter (CPython 3.10.4) and emits canonical expected
facts as JSON on stdout. Two independent sources, per the brief:

  symtable -> scopes and bindings (all 11 Symbol predicates)   [ground truth]
  ast      -> structure, spans, attribute writes                [second implementation]

Nothing here is hand-written: every value comes from CPython. If this file is
wrong, everything downstream is wrong and nobody notices, so it also emits the
evidence needed to check itself (see `pairing` below).

Contract with the harness:
  - stdout is a single JSON object, keys sorted, deterministic across runs.
  - Any internal inconsistency is reported as a structured `error`, never a
    silent omission and never an exception traceback.

Usage:  emit_oracle.py --file X.py [--module-qname a.b.c]
        emit_oracle.py --source-stdin --virtual-path <p> [--module-qname q]
        emit_oracle.py --selfcheck
"""

import argparse
import ast
import builtins
import hashlib
import json
import os
import symtable
import sys

# ---------------------------------------------------------------------------
# Pinned-target guard. Appendix B invariant #10: the environment that produced a
# golden file must be recoverable from it, and the emitter must refuse to run
# under an interpreter whose behaviour differs from the frozen emissionRegime.
# ---------------------------------------------------------------------------

#: DERIVED, never asserted. This was the literal "PY3_0_11", which was true only
#: because the emitter could not run anywhere else. Hard-coding it now would stamp
#: 3.12 output with a 3.10 regime and make two structurally different fact sets
#: look comparable — the single worst failure available here, because nothing
#: downstream would flag it.
EMISSION_REGIME = "PY3_12_PLUS" if sys.version_info >= (3, 12) else "PY3_0_11"

#: The 11 predicates of symtable.Symbol, in symtable's own declaration order.
#: py_binding columns 4..14 mirror this list exactly (schema v6 section 2.3).
SYMBOL_PREDICATES = (
    "is_parameter",
    "is_local",
    "is_global",
    "is_nonlocal",
    "is_free",
    "is_imported",
    "is_assigned",
    "is_referenced",
    "is_declared_global",
    "is_annotated",
    "is_namespace",
)

#: Synthetic binding CPython creates for the implicit comprehension iterator.
#: Asserted POSITIVELY (schema section 4.4): on PY3_0_11 every comprehension and
#: generator-expression scope must contain exactly one of these.
SYNTHETIC_ITERATOR = ".0"

COMPREHENSION_SCOPE_NAMES = ("listcomp", "setcomp", "dictcomp", "genexpr")

#: Which emission regime THIS interpreter produces (schema 2.1 c11).
#:
#: Not a preference — a measured, structural difference. PEP 709 inlines list, set
#: and dict comprehensions into the enclosing function from 3.12, so the SAME source
#: yields a different scope tree:
#:
#:   3.10.4   def f(): [x for x in r]   ->  f  ->  listcomp{'.0','x'}
#:   3.12.8   def f(): [x for x in r]   ->  f{'x','r'}          (no child scope)
#:
#: Generator expressions are NOT inlined and keep their scope and their '.0' on both.
#: Because emissionRegime is inside py_module's PK, a fact set from one regime can
#: never be compared to the other — they are different answers to different questions,
#: not agreement and disagreement.
IS_312_PLUS = sys.version_info >= (3, 12)
REGIME = "PY3_12_PLUS" if IS_312_PLUS else "PY3_0_11"

#: Comprehension forms that still open a scope under this regime.
_SCOPED_COMPREHENSIONS = (
    (ast.GeneratorExp,) if IS_312_PLUS
    else (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
)

#: ast node -> symtable scope type
_SCOPE_NODES = {
    ast.FunctionDef: "function",
    ast.AsyncFunctionDef: "function",
    ast.ClassDef: "class",
    ast.Lambda: "function",
    ast.GeneratorExp: "function",
}
if not IS_312_PLUS:
    _SCOPE_NODES[ast.ListComp] = "function"
    _SCOPE_NODES[ast.SetComp] = "function"
    _SCOPE_NODES[ast.DictComp] = "function"
else:
    # PEP 695. `type X = ...` is a statement that opens its own lazily-evaluated
    # scope, which symtable reports as "type alias".
    _SCOPE_NODES[ast.TypeAlias] = "type alias"
    # A bound is LAZILY EVALUATED and therefore gets a scope of its own, named
    # after the type parameter: `def f[V: int]` -> TypeVar bound scope "V".
    # Discovered by running the emitter, not by reading the PEP — it is a third
    # scope type beyond the wrapper and the subject.
    _SCOPE_NODES[ast.TypeVar] = "TypeVar bound"

#: PEP 695 introduces a WRAPPER scope around any construct carrying type
#: parameters, so `class C[T]` is two nested symtable scopes, not one:
#:     type parameter C {'.type_params','.generic_base','T'}
#:       class          C {'T','__type_params__','m'}
#: The schema anticipated this — py_scope.scopeKind already lists TYPE_PARAM and
#: TYPE_ALIAS (2.2) — so the wrapper is EMITTED as a real scope rather than
#: skipped. Skipping it would lose where T is bound, which is the one fact
#: py_type_parameter exists to record.
TYPE_PARAM_SCOPE = "type parameter"
TYPEVAR_BOUND_SCOPE = "TypeVar bound"

#: Names CPython itself injects. Held apart from user bindings so a synthetic name
#: is never reported as a missing or spurious binding.
SYNTHETIC_NAMES = frozenset({
    ".0", ".type_params", ".generic_base", ".defaults",
    "__type_params__", "__classdict__", "__conditional_annotations__",
})


def _opens_scope(node):
    """Does this ast node actually open a symtable scope?

    Type membership alone is not enough for one case: an ast.TypeVar opens a
    "TypeVar bound" scope only when it HAS a bound. `class C[T]` has a TypeVar and
    no scope for it, so a pure type test produced three phantom children and took
    the whole class subtree down with it.
    """
    t = type(node)
    if t not in _SCOPE_NODES:
        return False
    if IS_312_PLUS and t is ast.TypeVar:
        return node.bound is not None
    return True


def _type_params(node):
    """PEP 695 type parameters on a node, or () before 3.12."""
    return tuple(getattr(node, "type_params", ()) or ())


def _scope_name_for(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return node.name
    # `type X[T] = ...` — ast.TypeAlias.name is a Name node, not a str.
    if IS_312_PLUS and isinstance(node, ast.TypeAlias):
        return node.name.id
    if IS_312_PLUS and isinstance(node, ast.TypeVar):
        return node.name
    return {
        ast.Lambda: "lambda",
        ast.ListComp: "listcomp",
        ast.SetComp: "setcomp",
        ast.DictComp: "dictcomp",
        ast.GeneratorExp: "genexpr",
    }[type(node)]


def _scope_kind_for(node, st_type):
    # Checked BEFORE the node type, because one ast node backs two scopes under
    # PEP 695 and only the symtable type distinguishes them.
    if st_type == TYPE_PARAM_SCOPE:
        return "TYPE_PARAM"
    if st_type == TYPEVAR_BOUND_SCOPE:
        # NOT in the frozen py_scope.scopeKind enum (2.2 lists TYPE_PARAM and
        # TYPE_ALIAS only). Emitted under this name and flagged for ratification:
        # the oracle reports what CPython does, and the schema has to catch up.
        return "TYPE_PARAM_BOUND"
    if st_type == "type alias":
        return "TYPE_ALIAS"
    if st_type == "class":
        return "CLASS"
    if isinstance(node, ast.Lambda):
        return "LAMBDA"
    if isinstance(node, ast.ListComp):
        return "COMPREHENSION_LIST"
    if isinstance(node, ast.SetComp):
        return "COMPREHENSION_SET"
    if isinstance(node, ast.DictComp):
        return "COMPREHENSION_DICT"
    if isinstance(node, ast.GeneratorExp):
        return "GENERATOR_EXPRESSION"
    if isinstance(node, ast.AsyncFunctionDef):
        return "FUNCTION"
    return "FUNCTION"


def _scope_name_for_st(node, st_type):
    """Scope name as symtable reports it — the wrapper borrows its subject's name.

    Deliberately just delegates. The first version reached for `node.name`
    directly, which is a str on FunctionDef and ClassDef but an ast.Name on
    TypeAlias, so `type Alias[W] = ...` compared a Name object against the string
    "Alias" and never matched. _scope_name_for already knows that difference;
    there was nothing here worth re-deriving.
    """
    return _scope_name_for(node)


def _enclosing_evaluated_parts(scope_node):
    """Sub-parts of a scope-introducing node that are evaluated in the ENCLOSING
    scope, so any scope they contain belongs to the PARENT, not to `scope_node`.

    This is the subtlety that makes naive pairing wrong:
        def f(x=lambda: 1)     -> the lambda is a child of f's ENCLOSING scope
        @deco(lambda: 1)       -> likewise
        def f(x: C[lambda: 1]) -> likewise
        class K(Base(lambda:1))-> likewise
        [x for x in <iter>]    -> the OUTERMOST iterable is evaluated outside
    """
    parts = []
    # PEP 695 SPLITS this set. When a construct carries type parameters, some of
    # its sub-parts move from the parent scope into the type-parameter wrapper,
    # because they can SEE the type parameters and the parent cannot:
    #
    #   def f[U](a=lambda: 2, b: (lambda: 3) = 4)
    #        defaults  -> parent   (evaluated before U exists; symtable passes
    #                               them in as '.defaults')
    #        annotations, returns, bases, keywords -> WRAPPER
    #
    # Verified against symtable, not inferred: `class Child[T](Base[lambda: T])`
    # puts that lambda under `type parameter Child`, and a walk that gave it to
    # the enclosing function left it unpaired.
    has_tp = bool(_type_params(scope_node))
    if isinstance(scope_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        parts.extend(scope_node.decorator_list)
        a = scope_node.args
        parts.extend(a.defaults)
        parts.extend([d for d in a.kw_defaults if d is not None])
        if not has_tp:
            for arg in a.posonlyargs + a.args + a.kwonlyargs + \
                    ([a.vararg] if a.vararg else []) + ([a.kwarg] if a.kwarg else []):
                if arg.annotation is not None:
                    parts.append(arg.annotation)
            if scope_node.returns is not None:
                parts.append(scope_node.returns)
    elif isinstance(scope_node, ast.ClassDef):
        parts.extend(scope_node.decorator_list)
        if not has_tp:
            parts.extend(scope_node.bases)
            parts.extend([k.value for k in scope_node.keywords])
    elif isinstance(scope_node, ast.Lambda):
        a = scope_node.args
        parts.extend(a.defaults)
        parts.extend([d for d in a.kw_defaults if d is not None])
    elif isinstance(scope_node, _SCOPED_COMPREHENSIONS):
        if scope_node.generators:
            parts.append(scope_node.generators[0].iter)
    # PEP 695 bounds and defaults are evaluated in the type-parameter WRAPPER, so
    # from the subject's point of view they are enclosing-evaluated. Without this
    # a lambda in a bound is collected twice: once by the wrapper, correctly, and
    # again when descending into the class or function.
    # Type parameters are deliberately NOT listed here. "Enclosing-evaluated" means
    # evaluated in the PARENT scope, and a bound is not: it is evaluated in the PEP
    # 695 wrapper, which sits between the parent and the subject. Adding them here
    # attributed every bound to the module instead of to its wrapper. The wrapper
    # claims them directly, in _type_param_part_scopes.
    return parts


def _wrapper_evaluated_parts(node):
    """Sub-parts evaluated in the PEP 695 wrapper rather than in the subject.

    Annotations, return annotations, bases and class keywords can all see the type
    parameters, so they are evaluated one level out. Defaults cannot and are not
    here — symtable passes those in as `.defaults`.
    """
    if not _type_params(node):
        return []
    parts = []
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        a = node.args
        for arg in a.posonlyargs + a.args + a.kwonlyargs + \
                ([a.vararg] if a.vararg else []) + ([a.kwarg] if a.kwarg else []):
            if arg.annotation is not None:
                parts.append(arg.annotation)
        if node.returns is not None:
            parts.append(node.returns)
    elif isinstance(node, ast.ClassDef):
        parts.extend(node.bases)
        parts.extend([k.value for k in node.keywords])
    return parts


def _type_param_part_scopes(node):
    """Scope-introducing nodes inside a construct's type-parameter list.

    `class C[T: SomeBound]` evaluates the bound in the WRAPPER scope, so a lambda
    or comprehension there belongs to the wrapper and not to the class.
    """
    found = []
    # Sub-parts that move INTO the wrapper because they can see the type
    # parameters — the mirror image of the split in _enclosing_evaluated_parts.
    for part in _wrapper_evaluated_parts(node):
        if _opens_scope(part):
            found.append(part)
        else:
            for sub in ast.walk(part):
                if _opens_scope(sub):
                    found.append(sub)
    for tp in _type_params(node):
        # A bounded TypeVar is ITSELF a scope; an unbounded one is not.
        if isinstance(tp, ast.TypeVar) and tp.bound is not None:
            found.append(tp)
            continue
        for part in (getattr(tp, "default_value", None),):
            if part is None:
                continue
            if _opens_scope(part):
                found.append(part)
            else:
                for sub in ast.walk(part):
                    if _opens_scope(sub):
                        found.append(sub)
    return found


def _owned_scope_nodes(node):
    """Every scope-introducing ast node belonging to `node`'s scope.

    Descends through non-scope children, and — critically — through the
    enclosing-evaluated parts of nested scope nodes (see above), which is where
    a naive walk loses lambdas hidden in defaults, decorators and annotations.
    Returned in source order; symtable's own order is EVALUATION order and is
    reconciled by matching, not by sorting (see _pair_children).
    """
    found = []
    # `node`'s OWN enclosing-evaluated parts belong to its PARENT, not to it.
    # Without this the same lambda is collected twice: once by the parent (right)
    # and again when descending into the child (wrong).
    # Both directions: parts the PARENT evaluates, and — under PEP 695 — parts the
    # WRAPPER evaluates. Missing the second set let `class Child[T](Base[lambda: T])`
    # collect its base's lambda twice, once correctly in the wrapper and once here.
    skip = {id(p) for p in _enclosing_evaluated_parts(node)}
    skip |= {id(p) for p in _wrapper_evaluated_parts(node)}

    def _children_excluding_type_params(n):
        """ast.iter_child_nodes, minus the PEP 695 type-parameter list.

        A construct's type parameters live in a scope of their own that sits
        BETWEEN this node and its parent, so neither end of that pair may collect
        them by walking. ast.iter_child_nodes cannot express "every field but one",
        which is why this goes through iter_fields.
        """
        for field, value in ast.iter_fields(n):
            if field == "type_params":
                continue
            if isinstance(value, ast.AST):
                yield value
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, ast.AST):
                        yield item

    def rec(n):
        for child in _children_excluding_type_params(n):
            if id(child) in skip:
                continue
            if _opens_scope(child):
                found.append(child)
                for part in _enclosing_evaluated_parts(child):
                    rec_root(part)
            else:
                rec(child)

    def rec_root(n):
        if _opens_scope(n):
            found.append(n)
            for part in _enclosing_evaluated_parts(n):
                rec_root(part)
        else:
            rec(n)

    rec(node)
    found.sort(key=lambda x: (getattr(x, "lineno", 0), getattr(x, "col_offset", 0)))
    return found


def _pair_children(ast_nodes, st_children):
    """Pair symtable children to ast nodes.

    symtable orders children by CPython's symbol-table construction order, which
    is NEITHER source order nor line order:

        def outer():
            @d(lambda: 'DEC')
            def f(x=lambda: 'DEF', *, y: C[lambda: 'ANN'] = 2): pass

        symtable -> [lambda@3, lambda@3, lambda@2, f@3]

    So pairing must be by IDENTITY (type, name, line) with a left-to-right
    column tie-break, not by index. Returns (pairs, problems) where pairs is a
    list of (st_child, ast_node) in symtable order.
    """
    remaining = list(ast_nodes)
    pairs, problems = [], []
    for sc in st_children:
        st_type = sc.get_type()
        if st_type == TYPE_PARAM_SCOPE:
            # PEP 695 wrapper: same ast node as the construct it wraps, matched on
            # ACTUALLY CARRYING type parameters. Without that last test a plain
            # `class C` on the same line would be an equally good candidate.
            cands = [n for n in remaining
                     if _type_params(n)
                     and _scope_name_for_st(n, st_type) == sc.get_name()
                     and n.lineno == sc.get_lineno()]
        else:
            cands = [n for n in remaining
                     if _SCOPE_NODES.get(type(n)) == st_type
                     and _scope_name_for(n) == sc.get_name()
                     and n.lineno == sc.get_lineno()]
        if not cands:
            problems.append(
                "no ast node for symtable child %s:%s@%d" %
                (sc.get_type(), sc.get_name(), sc.get_lineno()))
            continue
        chosen = min(cands, key=lambda n: n.col_offset)
        remaining.remove(chosen)
        pairs.append((sc, chosen))
    for leftover in remaining:
        problems.append(
            "ast node %s:%s@%d:%d has no symtable child" %
            (_SCOPE_NODES.get(type(leftover), type(leftover).__name__),
             _scope_name_for(leftover),
             leftover.lineno, leftover.col_offset))
    return pairs, problems


def _end_of(node):
    return (
        getattr(node, "end_lineno", None) or getattr(node, "lineno", 0),
        getattr(node, "end_col_offset", None) or getattr(node, "col_offset", 0),
    )


class OracleError(Exception):
    pass


class Emitter:
    def __init__(self, source: str, path: str, module_qname: str):
        self.source = source
        self.path = path
        self.module_qname = module_qname
        self.errors = []
        self.pairing = []          # symtable<->ast pairing evidence
        self.scopes = []
        self.bindings = []
        self.attribute_writes = []
        self.structure = {}
        self.classifications = []

    # -- helpers ----------------------------------------------------------
    def _err(self, kind, detail, **extra):
        row = {"kind": kind, "detail": detail}
        row.update(extra)
        self.errors.append(row)

    def _scope_id(self, parent_id, kind, name, line, col):
        """Mirror of PY_SCOPE_md5(module || parent || kind || name || line || col).

        The oracle computes the SAME key the parser must compute. If the parser
        derives a different id for the same scope, the set-difference shows it
        as one spurious + one missing row rather than a silent mismatch.
        """
        content = "||".join(
            [self.module_qname, self.path, parent_id or "", kind, name, str(line), str(col)]
        )
        return "PY_SCOPE_" + hashlib.md5(content.encode("utf-8")).hexdigest()

    # -- main -------------------------------------------------------------
    def run(self):
        tree = ast.parse(self.source, filename=self.path)
        st = symtable.symtable(self.source, self.path, "exec")

        root_id = self._scope_id(None, "MODULE", "top", 0, 0)
        self._walk(tree, st, root_id, "MODULE", "top", 0, 0, depth=0, ordinal=0,
                   qualname=self.module_qname)
        self._collect_structure(tree)
        return self._payload()

    def _walk(self, node, st, scope_id, kind, name, line, col, depth, ordinal, qualname):
        end_line, end_col = _end_of(node) if not isinstance(node, ast.Module) else self._module_end()
        self.scopes.append(
            {
                "scopeId": scope_id,
                "scopeKind": kind,
                "name": name,
                "qualifiedName": qualname,
                "nestingDepth": depth,
                "parentScopeId": None if depth == 0 else self._current_parent,
                "isNested": bool(st.is_nested()),
                "isOptimized": bool(st.is_optimized()),
                "hasChildren": bool(st.has_children()),
                "symtableId": self._canonical_id(scope_id),
                "symtableType": st.get_type(),
                "usesWildcardImport": self._uses_wildcard(node),
                "declaresGlobal": self._declares(node, ast.Global),
                "declaresNonlocal": self._declares(node, ast.Nonlocal),
                "startLine": line,
                "startColumn": col,
                "endLine": end_line,
                "endColumn": end_col,
                "scopeOrdinal": ordinal,
                "symtableLineno": st.get_lineno(),
            }
        )
        self._emit_bindings(st, scope_id, kind, name)

        # ---- the pairing assertion --------------------------------------
        # py_scope.startColumn is ast-derived; symtable exposes only a line. The
        # PK therefore depends on pairing symtable children to ast nodes. That
        # pairing is only valid if symtable's get_children() is in source order.
        ast_children = _owned_scope_nodes(node)
        if kind == "TYPE_PARAM":
            # Inside a PEP 695 wrapper the ONLY child construct is the subject
            # itself, re-entered under its own scope type. Anything else here comes
            # from a bound or a default, which is evaluated in the wrapper:
            #     class C[T: (lambda: int)()]   -> the lambda is the wrapper's child
            ast_children = [node] + _type_param_part_scopes(node)
        st_children = list(st.get_children())
        pairs, problems = _pair_children(ast_children, st_children)

        self.pairing.append(
            {
                "scopeId": scope_id,
                "scopeName": name,
                "astChildren": [
                    {
                        "type": _SCOPE_NODES[type(c)],
                        "name": _scope_name_for(c),
                        "line": c.lineno,
                        "col": c.col_offset,
                    }
                    for c in ast_children
                ],
                "symtableChildren": [
                    {"type": c.get_type(), "name": c.get_name(), "line": c.get_lineno()}
                    for c in st_children
                ],
                "pairedColumns": [
                    {
                        "type": sc.get_type(), "name": sc.get_name(),
                        "line": sc.get_lineno(), "col": an.col_offset,
                    }
                    for sc, an in pairs
                ],
                "unpaired": problems,
            }
        )

        if problems:
            for pr in problems:
                self._err("PAIRING_UNMATCHED", pr, scope=name)
            return

        for i, (sc, a) in enumerate(pairs):
            child_kind = _scope_kind_for(a, sc.get_type())
            child_name = _scope_name_for(a)
            child_id = self._scope_id(scope_id, child_kind, child_name, a.lineno, a.col_offset)
            prev_parent = getattr(self, "_current_parent", None)
            self._current_parent = scope_id
            child_qname = self._qualname(qualname, kind, child_kind, child_name)
            self._walk(a, sc, child_id, child_kind, child_name, a.lineno, a.col_offset,
                       depth + 1, i, child_qname)
            self._current_parent = prev_parent

    _current_parent = None

    def _canonical_id(self, scope_id):
        """A DETERMINISTIC stand-in for symtable.SymbolTable.get_id().

        get_id() returns id() of the underlying object, so it is stable within a
        process but varies across processes (heap layout / ASLR). Emitting it
        would make every golden file differ run-to-run and break Appendix B
        invariant #5 — the harness self-test caught exactly this.

        The column's documented purpose (schema v6 section 2.2 c11) is "oracle
        cross-check handle only; never joined on", so a canonical pre-order
        ordinal serves it exactly and is reproducible.
        """
        if not hasattr(self, "_canon"):
            self._canon = {}
        if scope_id not in self._canon:
            self._canon[scope_id] = len(self._canon)
        return self._canon[scope_id]

    def _qualname(self, parent_qname, parent_kind, child_kind, child_name):
        """CPython __qualname__ semantics, including the <locals> marker."""
        if parent_kind in ("FUNCTION", "LAMBDA") or parent_kind.startswith("COMPREHENSION") \
                or parent_kind == "GENERATOR_EXPRESSION":
            return "%s.<locals>.%s" % (parent_qname, child_name)
        return "%s.%s" % (parent_qname, child_name)

    def _module_end(self):
        lines = self.source.splitlines()
        return (len(lines) if lines else 0, len(lines[-1]) if lines else 0)

    def _uses_wildcard(self, node):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ImportFrom) and any(a.name == "*" for a in child.names):
                return True
        return False

    def _declares(self, node, cls):
        for n in ast.walk(node):
            if isinstance(n, cls):
                return True
            if n is not node and type(n) in _SCOPE_NODES:
                continue
        return any(isinstance(n, cls) for n in ast.walk(node))

    def _emit_bindings(self, st, scope_id, scope_kind, scope_name):
        syms = list(st.get_symbols())
        names = [s.get_name() for s in syms]
        if len(names) != len(set(names)):
            self._err("DUPLICATE_SYMBOL", "symtable returned a duplicate name in one scope",
                      scope=scope_name)
        for sym in sorted(syms, key=lambda s: s.get_name()):
            row = {
                "scopeId": scope_id,
                "name": sym.get_name(),
                "isSynthetic": sym.get_name() == SYNTHETIC_ITERATOR,
            }
            for pred in SYMBOL_PREDICATES:
                row[pred] = bool(getattr(sym, pred)())
            self.bindings.append(row)

        # POSITIVE assertion, not a whitelist: a whitelist would also pass when
        # the binding is MISSING. On PY3_0_11 every comprehension / genexpr scope
        # has exactly one `.0`; no other scope kind may have one.
        # Under PY3_12_PLUS only a generator expression still owns a scope, so only
        # it still owns a '.0'. Asserting the 3.10 rule on 3.12 would report every
        # inlined comprehension as a missing synthetic iterator.
        is_comp = scope_kind == "GENERATOR_EXPRESSION" or (
            not IS_312_PLUS and scope_kind.startswith("COMPREHENSION"))
        count = names.count(SYNTHETIC_ITERATOR)
        if is_comp and count != 1:
            self._err("SYNTHETIC_ITERATOR_MISSING",
                      "comprehension scope must contain exactly one '.0'",
                      scope=scope_name, kind=scope_kind, found=count)
        if not is_comp and count != 0:
            self._err("SYNTHETIC_ITERATOR_UNEXPECTED",
                      "'.0' found outside a comprehension scope",
                      scope=scope_name, kind=scope_kind, found=count)

    # -- ast-side structure (second implementation) ------------------------
    def _collect_structure(self, tree):
        classes, functions, imports, calls = [], [], [], []
        classifications = []
        assignments = []
        writes = []

        class V(ast.NodeVisitor):
            def __init__(self, outer):
                self.o = outer
                self.cls = []
                self.fn = []
                # Two independent stacks cannot answer "what is the IMMEDIATELY
                # enclosing scope" -- a class inside a function makes both
                # non-empty. Defect #7 was exactly that: `bool(cls) and not fn`
                # sent every method of a function-local class to NESTED_FUNCTION,
                # including __init__. Keep the nesting ORDER.
                self.enclosing = []   # 'C' | 'F', innermost last

            def visit_ClassDef(self, n):
                bases = []
                for i, b in enumerate(n.bases):
                    bases.append({"position": i, "kind": _base_kind(b), "text": _txt(b)})
                for k in n.keywords:
                    bases.append({"position": None, "kind": "KEYWORD",
                                  "keyword": k.arg, "text": _txt(k.value)})
                classifications.append({
                    "entity": "py_type", "name": n.name,
                    "line": n.lineno, "col": n.col_offset,
                    "tier1": {
                        "typeModifier": type_modifier_ast(n),
                        "typeCategoryEvidence": type_category_ast_evidence(n),
                    },
                })
                classes.append({
                    "name": n.name, "line": n.lineno, "col": n.col_offset,
                    "endLine": n.end_lineno, "endCol": n.end_col_offset,
                    "bases": bases,
                    "decorators": [_txt(d) for d in n.decorator_list],
                    "docstring": ast.get_docstring(n) is not None,
                })
                self.cls.append(n); self.enclosing.append('C')
                self.generic_visit(n)
                self.enclosing.pop(); self.cls.pop()

            def _fn(self, n, is_async):
                a = n.args
                params = []
                for kindname, group in (("POSITIONAL_ONLY", a.posonlyargs),
                                        ("POSITIONAL_OR_KEYWORD", a.args),
                                        ("KEYWORD_ONLY", a.kwonlyargs)):
                    for arg in group:
                        params.append({"name": arg.arg, "paramKind": kindname,
                                       "annotation": _txt(arg.annotation) if arg.annotation else "",
                                       "line": arg.lineno, "col": arg.col_offset})
                if a.vararg:
                    params.append({"name": a.vararg.arg, "paramKind": "VAR_POSITIONAL",
                                   "annotation": _txt(a.vararg.annotation) if a.vararg.annotation else "",
                                   "line": a.vararg.lineno, "col": a.vararg.col_offset})
                if a.kwarg:
                    params.append({"name": a.kwarg.arg, "paramKind": "VAR_KEYWORD",
                                   "annotation": _txt(a.kwarg.annotation) if a.kwarg.annotation else "",
                                   "line": a.kwarg.lineno, "col": a.kwarg.col_offset})
                # innermost enclosing scope, by nesting order -- not by which
                # stack happens to be non-empty
                innermost = self.enclosing[-1] if self.enclosing else None
                encl_is_class = innermost == 'C'
                encl_kind = ("CLASS" if innermost == 'C'
                             else "FUNCTION" if innermost == 'F' else "MODULE")
                mk, mk_residue = method_kind_ast(n, encl_kind, encl_is_class)
                classifications.append({
                    "entity": "py_method", "name": n.name,
                    "line": n.lineno, "col": n.col_offset,
                    "tier1": {"methodKind": mk},
                    "residue": mk_residue,
                })
                functions.append({
                    "name": n.name, "line": n.lineno, "col": n.col_offset,
                    "endLine": n.end_lineno, "endCol": n.end_col_offset,
                    "isAsync": is_async,
                    "ownerClass": self.cls[-1].name if self.cls else "",
                    "enclosingFunction": self.fn[-1].name if self.fn else "",
                    "params": params,
                    "posOnlyCount": len(a.posonlyargs),
                    "kwOnlyCount": len(a.kwonlyargs),
                    "hasVarArgs": a.vararg is not None,
                    "hasKwArgs": a.kwarg is not None,
                    "returnAnnotation": _txt(n.returns) if n.returns else "",
                    "decorators": [_txt(d) for d in n.decorator_list],
                    "isGenerator": _has_yield(n),
                })
                self.fn.append(n); self.enclosing.append('F')
                self.generic_visit(n)
                self.enclosing.pop(); self.fn.pop()

            def visit_FunctionDef(self, n): self._fn(n, False)
            def visit_AsyncFunctionDef(self, n): self._fn(n, True)

            def visit_Import(self, n):
                for al in n.names:
                    k, res = import_kind_ast(n, al)
                    classifications.append({
                        "entity": "py_import", "name": al.asname or al.name,
                        "line": n.lineno, "col": n.col_offset,
                        "tier1": {"importKind": k}, "residue": res,
                    })
                    imports.append({"kind": "MODULE_IMPORT_ALIAS" if al.asname else "MODULE_IMPORT",
                                    "importedPath": al.name, "bound": al.asname or al.name.split(".")[0],
                                    "relativeLevel": 0, "line": n.lineno})
                self.generic_visit(n)

            def visit_ImportFrom(self, n):
                for al in n.names:
                    k, res = import_kind_ast(n, al)
                    classifications.append({
                        "entity": "py_import", "name": al.asname or al.name,
                        "line": n.lineno, "col": n.col_offset,
                        "tier1": {"importKind": k}, "residue": res,
                    })
                    if al.name == "*":
                        kind = "RELATIVE_WILDCARD" if n.level else "FROM_WILDCARD"
                        bound = "*"
                    elif n.level:
                        kind = "RELATIVE_MEMBER"; bound = al.asname or al.name
                    else:
                        kind = "FROM_MEMBER_ALIAS" if al.asname else "FROM_MEMBER"
                        bound = al.asname or al.name
                    imports.append({"kind": kind, "importedPath": al.name,
                                    "module": n.module or "", "bound": bound,
                                    "relativeLevel": n.level or 0, "line": n.lineno})
                self.generic_visit(n)

            def visit_Call(self, n):
                f = n.func
                recv_kind, recv_text, callee = "NONE", "", ""
                if isinstance(f, ast.Name):
                    callee = f.id
                elif isinstance(f, ast.Attribute):
                    callee = f.attr
                    b = f.value
                    recv_text = _txt(b)
                    if isinstance(b, ast.Name):
                        first = (self.fn[-1].args.posonlyargs + self.fn[-1].args.args) if self.fn else []
                        selfn = first[0].arg if (first and self.cls) else None
                        recv_kind = "SELF" if (selfn and b.id == selfn) else (
                            "CLS" if b.id == "cls" else "NAME")
                    elif isinstance(b, ast.Attribute):
                        recv_kind = "ATTRIBUTE"
                    elif isinstance(b, ast.Call):
                        recv_kind = "SUPER" if (isinstance(b.func, ast.Name) and b.func.id == "super") \
                            else "CALL_RESULT"
                    elif isinstance(b, ast.Subscript):
                        recv_kind = "SUBSCRIPT"
                    elif isinstance(b, ast.Constant):
                        recv_kind = "LITERAL"
                    else:
                        recv_kind = "UNKNOWN"
                calls.append({
                    "callee": callee, "receiverKind": recv_kind, "receiverText": recv_text,
                    "line": n.lineno, "col": n.col_offset,
                    "endLine": n.end_lineno, "endCol": n.end_col_offset,
                    "positionalArgs": len([a for a in n.args if not isinstance(a, ast.Starred)]),
                    "keywordArgs": len([k for k in n.keywords if k.arg]),
                    "hasStarArgs": any(isinstance(a, ast.Starred) for a in n.args),
                    "hasDoubleStarArgs": any(k.arg is None for k in n.keywords),
                    "keywordNames": sorted(k.arg for k in n.keywords if k.arg),
                    "enclosingFunction": self.fn[-1].name if self.fn else "",
                    "enclosingClass": self.cls[-1].name if self.cls else "",
                })
                self.generic_visit(n)

            # attribute writes: symtable is structurally blind to these
            def visit_Assign(self, n):
                # Assignment STRUCTURE, so target<->value pairing is adjudicable.
                # ast.Assign is one node owning both sides; schema section 2.15
                # models that as an ASSIGNMENT expression parenting an
                # ASSIGNMENT_TARGET and an ASSIGNMENT_VALUE child. An IR that
                # emits the two sides as unrelated roots cannot answer "what was
                # assigned into this name", which is the join every local-variable
                # typing rule starts from.
                assignments.append({
                    "line": n.lineno, "col": n.col_offset,
                    "targets": [_txt(t) for t in n.targets],
                    "targetKinds": [type(t).__name__ for t in n.targets],
                    "valueKind": type(n.value).__name__,
                    "valueText": _txt(n.value),
                    "isChained": len(n.targets) > 1,
                })
                for t in n.targets:
                    self._target(t, "ASSIGN")
                self.generic_visit(n)

            def visit_AnnAssign(self, n):
                self._target(n.target, "ANN_ASSIGN"); self.generic_visit(n)

            def visit_AugAssign(self, n):
                self._target(n.target, "AUG_ASSIGN"); self.generic_visit(n)

            def _target(self, t, kind):
                if isinstance(t, ast.Attribute):
                    base = t.value
                    recv = ""
                    origin = "OTHER_OBJECT"
                    if isinstance(base, ast.Name):
                        first = (self.fn[-1].args.posonlyargs + self.fn[-1].args.args) if self.fn else []
                        selfn = first[0].arg if (first and self.cls) else None
                        recv = base.id
                        if selfn and base.id == selfn:
                            origin = "SELF_AUGASSIGN" if kind == "AUG_ASSIGN" else "SELF_ASSIGN"
                    writes.append({
                        "attribute": t.attr, "origin": origin, "receiverName": recv,
                        "ownerClass": self.cls[-1].name if self.cls else "",
                        "method": self.fn[-1].name if self.fn else "",
                        "line": t.lineno, "col": t.col_offset, "writeKind": kind,
                    })
                elif isinstance(t, (ast.Tuple, ast.List)):
                    for e in t.elts:
                        self._target(e, kind)

        V(self).visit(tree)
        self.attribute_writes = writes
        self.structure = {
            "classes": classes, "functions": functions,
            "imports": imports, "calls": calls,
            "assignments": sorted(assignments, key=lambda a: (a["line"], a["col"])),
        }
        self.classifications = sorted(
            classifications, key=lambda c: (c["entity"], c["line"], c["col"], c["name"]))

    def _payload(self):
        return {
            "provenance": provenance(),
            "module": {
                "filePath": self.path,
                "qualifiedName": self.module_qname,
                "emissionRegime": EMISSION_REGIME,
                "hasDunderAll": self._dunder_all()[0],
                "dunderAllIsStatic": self._dunder_all()[1],
                "dunderAllNames": self._dunder_all()[2],
            },
            "scopes": self.scopes,
            "bindings": self.bindings,
            "attributeWrites": self.attribute_writes,
            "structure": self.structure,
            "classifications": self.classifications,
            "pairing": self.pairing,
            "errors": self.errors,
        }

    def _dunder_all(self):
        tree = ast.parse(self.source, filename=self.path)
        for s in tree.body:
            tgt = None
            if isinstance(s, ast.Assign) and len(s.targets) == 1 \
                    and isinstance(s.targets[0], ast.Name) and s.targets[0].id == "__all__":
                tgt = s.value
            elif isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name) \
                    and s.target.id == "__all__":
                tgt = s.value
            if tgt is None:
                continue
            if isinstance(tgt, (ast.List, ast.Tuple)) and all(
                    isinstance(e, ast.Constant) and isinstance(e.value, str) for e in tgt.elts):
                return True, True, sorted(e.value for e in tgt.elts)
            return True, False, []
        return False, False, []


def _has_yield(fn):
    """Does THIS function body yield -- not a nested one.

    Defect #8: the previous version used ast.walk over the whole subtree, so a
    `yield` inside a nested def or a comprehension made the OUTER function a
    generator. A yield binds to the nearest enclosing function scope, so the
    walk must stop at every scope boundary.
    """
    def scan(node):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.Yield, ast.YieldFrom)):
                return True
            # a nested scope owns its own yields
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef,
                                  ast.Lambda, ast.ClassDef)):
                continue
            if scan(child):
                return True
        return False

    return scan(fn)


def _base_kind(b):
    if isinstance(b, ast.Name):
        return "NAME"
    if isinstance(b, ast.Attribute):
        return "DOTTED_NAME"
    if isinstance(b, ast.Subscript):
        return "SUBSCRIPT"
    if isinstance(b, ast.Call):
        return "CALL"
    if isinstance(b, ast.Starred):
        return "STARRED"
    return "OTHER"


def _txt(node):
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return "<unparseable>"


# ===========================================================================
# TIER 1 — CPython-adjudicated (ast structural).
#
# Every value below is decided by NODE SHAPE alone: no name-recognition list, no
# priority fiat, no import. These are as adjudicable as py_scope/py_binding and
# are emitted for Gate 1 comparison.
#
# What is deliberately NOT here is the residue, which is spec-adjudicated and
# lives in python-work/FIELD-CLASSIFICATION-SPEC.md. Emitting a guess here would
# launder a decision into ground truth.
# ===========================================================================

#: Decorator names whose meaning is fixed by the language, not by convention.
#: Used ONLY where the decorator is a bare name or a dotted path ending in one
#: of these; anything else is unrecognised and stays residue.
_STDLIB_METHOD_DECORATORS = {
    "staticmethod": "STATIC", "classmethod": "CLASS", "property": "PROPERTY",
    # `@x.setter` / `@x.deleter` / `@x.getter` -- the property protocol. Matched
    # on the TAIL, so any receiver works. Omitting these was a real bug: it made
    # every property setter in the stdlib look like an unrecognised decorator,
    # and 21 of 36 measured "default failures" were this, not the default.
    "setter": "SETTER", "deleter": "DELETER", "getter": "PROPERTY",
    "abstractmethod": "ABSTRACT", "abstractproperty": "ABSTRACT",
    "overload": "OVERLOAD", "final": "FINAL", "cached_property": "CACHED",
    # Wraps a generator into a plain callable, so the `yield` in the body is an
    # implementation detail of the CM protocol, not a generator signature.
    "contextmanager": "CONTEXTMANAGER", "asynccontextmanager": "CONTEXTMANAGER",
}


def _decorator_path(node):
    """Dotted path of a decorator expression, or '' if it is not name-shaped."""
    n = node.func if isinstance(node, ast.Call) else node
    parts = []
    while isinstance(n, ast.Attribute):
        parts.append(n.attr)
        n = n.value
    if isinstance(n, ast.Name):
        parts.append(n.id)
        return ".".join(reversed(parts))
    return ""


def _decorator_tail(node):
    path = _decorator_path(node)
    return path.rsplit(".", 1)[-1] if path else ""


def import_kind_ast(node, alias):
    """TIER 1. importKind from node shape alone.

    Returns (kind, residue) — residue is non-empty when the shape is decidable
    but the ENUM cannot express it, which is a spec question, not an ast one.
    """
    if isinstance(node, ast.Import):
        return ("MODULE_IMPORT_ALIAS" if alias.asname else "MODULE_IMPORT"), ""
    # ast.ImportFrom
    star = alias.name == "*"
    if node.level and node.level > 0:
        if star:
            return "RELATIVE_WILDCARD", ""
        # The enum has no RELATIVE_MEMBER_ALIAS; a relative import WITH an alias
        # is decidable from ast but not expressible. Residue, not a guess.
        return "RELATIVE_MEMBER", ("RELATIVE_MEMBER_ALIAS" if alias.asname else "")
    if node.module == "__future__":
        # FUTURE vs FROM_MEMBER_ALIAS precedence is spec, but only when aliased.
        return "FUTURE", ("FUTURE_WITH_ALIAS" if alias.asname else "")
    if star:
        return "FROM_WILDCARD", ""
    return ("FROM_MEMBER_ALIAS" if alias.asname else "FROM_MEMBER"), ""


def method_kind_ast(node, enclosing_kind, enclosing_is_class):
    """TIER 1. The STRUCTURAL part of methodKind.

    Decided by node type, name and enclosing scope only. Returns
    (kind, residue) where a non-empty residue names a decorator-driven decision
    this function refuses to make -- those are tier 2 (descriptor type) or tier 3
    (priority order), never guessed here.
    """
    if isinstance(node, ast.Lambda):
        return "LAMBDA", ""

    name = node.name
    is_async = isinstance(node, ast.AsyncFunctionDef)
    has_yield = _has_yield(node)

    decos = [_decorator_tail(d) for d in node.decorator_list]
    recognised = [d for d in decos if d in _STDLIB_METHOD_DECORATORS]
    unrecognised = [d for d in decos if d and d not in _STDLIB_METHOD_DECORATORS]

    # async shape is unambiguous and beats everything structural
    # Python IMPLICITLY converts three dunders regardless of decorators
    # (verified on 3.10.4): __new__ -> staticmethod, __init_subclass__ and
    # __class_getitem__ -> classmethod. These are LANGUAGE RULES, not
    # decorator effects, so they belong in tier 1 and outrank everything.
    if enclosing_is_class and name in ("__init_subclass__", "__class_getitem__"):
        return "CLASS_METHOD", ""
    if enclosing_is_class and name == "__new__":
        return "ALLOCATOR", ""   # implicitly a staticmethod; ALLOCATOR is more specific

    if is_async:
        base = "ASYNC_GENERATOR" if has_yield else "ASYNC_FUNCTION"
    elif has_yield:
        base = "GENERATOR"
    elif enclosing_is_class:
        base = {"__init__": "CONSTRUCTOR", "__new__": "ALLOCATOR"}.get(name)
        if base is None:
            base = "DUNDER_METHOD" if (
                name.startswith("__") and name.endswith("__")) else "INSTANCE_METHOD"
    elif enclosing_kind in ("FUNCTION", "LAMBDA") or enclosing_kind.startswith("COMPREHENSION"):
        base = "NESTED_FUNCTION"
    else:
        base = "FUNCTION"

    # Any decorator that could OVERRIDE the structural answer is residue: the
    # priority order between them is a spec decision, not an ast fact.
    residue = ""
    if recognised or unrecognised:
        residue = "DECORATED:" + ",".join(sorted(set(decos)) or ["<expr>"])
    return base, residue


def type_modifier_ast(node):
    """TIER 1. Only the modifiers with NO runtime trace on 3.10.

    - FINAL: typing.final does NOT set __final__ before 3.11 (verified), so ast
      is the ONLY witness on this target.
    - SLOTS: a __slots__ assignment in the class body is a syntactic fact.
    Everything else is tier 2 and deliberately absent.
    """
    mods = []
    if any(_decorator_tail(d) == "final" for d in node.decorator_list):
        mods.append("FINAL")
    for stmt in node.body:
        targets = stmt.targets if isinstance(stmt, ast.Assign) else (
            [stmt.target] if isinstance(stmt, ast.AnnAssign) else [])
        if any(isinstance(t, ast.Name) and t.id == "__slots__" for t in targets):
            mods.append("SLOTS")
            break
    return sorted(set(mods))


def type_category_ast_evidence(node):
    """TIER 1 EVIDENCE, not a verdict.

    typeCategory is tier 2 (runtime-detectable, see emit_introspection.py). What
    ast can contribute is the raw base/keyword shape the classifier consumes.
    Emitting a category here would be a guess dressed as ground truth, so this
    returns evidence and lets the comparison layer decide which tier answers.
    """
    bases, keywords = [], {}
    for b in node.bases:
        bases.append({"kind": _base_kind(b), "text": _txt(b), "tail": _decorator_tail(b)})
    for k in node.keywords:
        keywords[k.arg or "**"] = {"text": _txt(k.value), "tail": _decorator_tail(k.value)}
    return {
        "bases": bases,
        "keywords": keywords,
        "decorators": [{"text": _txt(d), "tail": _decorator_tail(d)} for d in node.decorator_list],
        "hasSlots": "SLOTS" in type_modifier_ast(node),
        "bodyDunders": sorted({
            s.name for s in node.body
            if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))
            and s.name.startswith("__") and s.name.endswith("__")
        }),
    }


def provenance():
    """Appendix B invariant #10 — recorded into every golden file."""
    return {
        "interpreterPath": os.path.realpath(sys.executable),
        "sysVersion": sys.version,
        "versionInfo": list(sys.version_info[:3]),
        "emissionRegime": EMISSION_REGIME,
        "symbolPredicates": list(SYMBOL_PREDICATES),
        "oracleSchemaVersion": "v6",
    }


def selfcheck():
    """Assertions about the INTERPRETER, before we trust anything it says.

    These verify the environment matches the frozen emissionRegime. A 3.12
    interpreter would silently produce a structurally different scope tree
    (PEP 709 inlines comprehensions), so this must fail loudly, not warn.
    """
    problems = []
    # Two SUPPORTED regimes, each pinned to a version range. The check is that the
    # interpreter and the regime AGREE, not that the interpreter is one blessed
    # build — pinning to 3.10 alone is what blocked PEP 695 work, because
    # py_type_parameter cannot be adjudicated by an interpreter that has no
    # concept of a type parameter.
    SUPPORTED = {"PY3_0_11": (3, 10), "PY3_12_PLUS": (3, 12)}
    want = SUPPORTED.get(EMISSION_REGIME)
    if sys.version_info[:2] != want:
        problems.append("regime %s expects CPython %d.%d, got %s"
                        % (EMISSION_REGIME, want[0], want[1],
                           ".".join(map(str, sys.version_info[:3]))))

    # The regime's DEFINING behaviour, asserted rather than assumed: which
    # comprehension forms open a scope. This is the check that would catch a
    # 3.11 or 3.13 interpreter whose inlining rules differ from both regimes.
    src = "def f(a):\n    return [i for i in a], (j for j in a)\n"
    st = symtable.symtable(src, "<selfcheck>", "exec").get_children()[0]
    kids = sorted(c.get_name() for c in st.get_children())
    expect = ["genexpr"] if IS_312_PLUS else ["genexpr", "listcomp"]
    if kids != expect:
        problems.append("%s requires child scopes %r; got %r" % (EMISSION_REGIME, expect, kids))

    for c in symtable.symtable(src, "<s>", "exec").get_children()[0].get_children():
        if SYNTHETIC_ITERATOR not in [s.get_name() for s in c.get_symbols()]:
            problems.append("comprehension scope %r lacks %r" % (c.get_name(), SYNTHETIC_ITERATOR))

    # PEP 695 must be modelled where the regime claims to support it, or
    # py_type_parameter has no ground truth at all.
    if IS_312_PLUS:
        tp = symtable.symtable("class C[T]: pass\n", "<s>", "exec").get_children()[0]
        if tp.get_type() != TYPE_PARAM_SCOPE:
            problems.append("PY3_12_PLUS expects a %r scope for `class C[T]`; got %r"
                            % (TYPE_PARAM_SCOPE, tp.get_type()))
        elif "T" not in tp.get_identifiers():
            problems.append("type-parameter scope does not bind T: %r"
                            % (sorted(tp.get_identifiers()),))

    missing = [p for p in SYMBOL_PREDICATES
               if not hasattr(symtable.symtable("x=1", "<s>", "exec").get_symbols()[0], p)]
    if missing:
        problems.append("symtable.Symbol is missing predicates: %r" % (missing,))

    return {"ok": not problems, "problems": problems, "provenance": provenance()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--source-stdin", action="store_true")
    ap.add_argument("--virtual-path", default="<stdin>")
    ap.add_argument("--module-qname", default="")
    ap.add_argument("--selfcheck", action="store_true")
    args = ap.parse_args()

    if args.selfcheck:
        json.dump(selfcheck(), sys.stdout, indent=1, sort_keys=True)
        sys.stdout.write("\n")
        return 0

    if args.source_stdin:
        source = sys.stdin.read()
        path = args.virtual_path
    elif args.file:
        with open(args.file, "rb") as fh:
            source = fh.read().decode("utf-8", "replace")
        path = args.file
    else:
        json.dump({"fatal": "no input: pass --file or --source-stdin"}, sys.stdout)
        return 2

    qname = args.module_qname or os.path.splitext(os.path.basename(path))[0]
    try:
        payload = Emitter(source, path, qname).run()
    except SyntaxError as e:
        payload = {"provenance": provenance(),
                   "fatal": "SYNTAX_ERROR",
                   "detail": {"msg": e.msg, "line": e.lineno, "col": e.offset}}
    except RecursionError:
        payload = {"provenance": provenance(), "fatal": "RECURSION_LIMIT"}

    json.dump(payload, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
