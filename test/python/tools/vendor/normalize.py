"""THE shared normalisation module. Every consumer folds through here.

Single ownership exists for one reason: if two agents normalise differently their
numbers are not comparable, and every disagreement becomes an argument about the
oracle instead of the engine. The rules below are FIXED IN ADVANCE and are never
tuned per corpus. Adding a special case because one package looks bad is fitting
the oracle to the corpus.

Every rule here is applied IDENTICALLY to both sides of a comparison -- the
CPython-derived ground truth and the engine-derived answer. An asymmetry
manufactures fake defects, so each rule states what it does to *both* sides.

────────────────────────────────────────────────────────────────────────────────
RULE 1 -- ANCHOR: a callable is identified by (relpath, def-keyword line).

    The canonical anchor line is the line of the `def` / `async def` / `class` /
    `lambda` KEYWORD, as `ast` reports it (ast node .lineno has pointed at `def`
    rather than at the decorators since 3.8).

    This is not cosmetic. MEASURED on CPython 3.10.4, a decorated function's
    `__code__.co_firstlineno` points at the FIRST DECORATOR, not at the `def`:

        source            @deco        line 10
                          def run      line 11
        co_firstlineno                 10        <- decorator
        parser startLine               11        <- def

    Joining raw `co_filename:co_firstlineno` to `py_method.filePath:startLine`
    therefore fails for EVERY decorated function, in a way that looks exactly
    like an engine defect. `DecoratorIndex` folds the runtime line onto the def
    line using the file's own AST, so the fold is derived from the source rather
    than guessed.

RULE 2 -- DECORATORS: unwrap before joining, and record the wrapper too.

    `inspect.unwrap` follows `__wrapped__` (which `functools.wraps` sets) to the
    real body. The WRAPPER IS A REAL CALLEE -- tier 4 shows the executed chain
    caller -> wrapper -> body -- so it gets its own anchor and is never
    discarded. A decorator that does NOT use `functools.wraps` leaves no
    `__wrapped__`; the chain is then genuinely unrecoverable by introspection and
    the target is reported unresolved rather than guessed.

RULE 3 -- COMPREHENSION AND GENERATOR-EXPRESSION SCOPES FOLD INTO THEIR PARENT.

    `<listcomp>`, `<setcomp>`, `<dictcomp>`, `<genexpr>` are separate code
    objects to CPython but are not separate methods to the IR (verified: the
    parser emits no `py_method` row for them). A call site inside a comprehension
    is attributed to the lexically containing function on BOTH sides.

    A generator FUNCTION (a `def` containing `yield`) is a real function and is
    NOT folded. Only the implicit comprehension scopes are.

RULE 4 -- BOUND vs UNBOUND: always fold to the underlying function.

    `m.__func__` for bound and class methods; `.fget` for a property; `.__func__`
    for a staticmethod. `inspect.getattr_static` is used to reach these, never
    bare `getattr` -- MEASURED: bare `getattr(c, "prop")` EXECUTES the property
    getter (arbitrary code, during DB construction) and collapses a staticmethod
    to a plain function and a classmethod to a bound method, destroying exactly
    the distinctions being recorded.

RULE 5 -- MODULE-LEVEL CODE is the callable `<module>`, anchored at LINE 0.

    Executing a module body is not "no caller"; it is a caller. The IR agrees --
    it emits a MODULE_INITIALIZER method named `<module>`.

    Line 0, not line 1, and the reason is a real collision found while building
    this: a file whose FIRST LINE is `class A:` has a module scope and a class
    body that both report line 1, on the CPython side AND in the IR (the parser
    gives `<module>` startLine 1 and `class A` startLine 1). Anchoring module
    scope at the synthetic line 0 keeps the two distinguishable. Consumers
    reading IR must fold MODULE_INITIALIZER rows to line 0 as well -- that is
    what `ir_anchor_line` is for -- or the fold is asymmetric.

RULE 6 -- CLASS-BODY CODE is the callable `<classbody>` anchored at the `class`
    line. CPython names that code object after the class; the IR names it
    `<classbody>`. Both fold to the same anchor, so the naming difference cannot
    manufacture a defect.

RULE 7 -- NATIVE CALLEES HAVE NO ANCHOR, BY CONSTRUCTION.

    A C function has no Python source and no code object with a filename, so
    `math.sin` cannot join to an IR method. Native targets normalise to
    `NATIVE:<name>` and are classified `boundary_native`. They are never given a
    file anchor. An engine that "resolves" one to a source location has
    fabricated it.

RULE 8 -- QUALNAME is `<module qualname>.<__qualname__>`, `<locals>` retained.

    Matches the IR's `qualifiedName` exactly (verified: parser emits
    `d2.deco.<locals>.wrapper`; CPython gives module `d2` + qualname
    `deco.<locals>.wrapper`). Qualname is for READABILITY and as a cross-check;
    the ANCHOR is the join key, because qualnames collide and lie (a decorated
    function keeps the target's qualname while pointing at the wrapper's line).

RULE 10 -- EXECUTING A CLASS BODY OR A MODULE BODY IS A DEFINITION EVENT,
    NOT A CALL SITE, and is excluded from the must-have edge set.

    Tier 4 observes `<module> -> C.<classbody>` because CPython really does push
    a frame for a class body. But NO CALL SITE IN THE SOURCE SPELLS THAT EDGE:
    the site tier 1 records is the implicit `__build_class__`, which is a C
    function and therefore native. Demanding the engine emit an edge that no
    source construct expresses would be scoring it against an artefact of the
    interpreter's implementation.

    These edges are RETAINED in the record and TAGGED `definitional`, never
    dropped -- conservation is the point, and a silently discarded edge is
    exactly what this harness exists to prevent. They are excluded only from the
    recall denominator, and identically on both sides.

    THE SAME APPLIES ON THE SITE SIDE. `dis` reports a call instruction for
    `__build_class__` (every `class` statement) and for the immediately-invoked
    code object of a comprehension. The compiler synthesised both; NO CALL IS
    WRITTEN THERE. MEASURED on `04-mro-diamond`: CPython reports 14 sites and the
    IR reports 10, and the difference is exactly the 4 `class` statements. Scored
    naively that reads as the parser silently dropping 4 sites, which is a
    manufactured defect of precisely the kind this module exists to prevent.

    Such sites are TAGGED `implicit` and excluded from the CONSERVATION
    denominator. They are still inventoried, so a genuine regression in how they
    are handled remains visible. `print(...)` is NOT implicit: it has a native
    target but the source really does spell the call.

RULE 9 -- PATHS are POSIX relpaths from the corpus root. Absolute paths and
    `\\` separators never appear in a normalised record, so a lock file is
    machine-independent and reviewable.
"""

from __future__ import annotations

import ast
import os
import posixpath
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

# Implicit comprehension scopes -- Rule 3. A generator FUNCTION is not in this
# set; only the anonymous scopes the compiler synthesises.
COMPREHENSION_SCOPES = frozenset({'<listcomp>', '<setcomp>', '<dictcomp>', '<genexpr>'})

MODULE_SCOPE = '<module>'
CLASS_BODY_SCOPE = '<classbody>'
NATIVE_PREFIX = 'NATIVE:'


def relpath(path: str, root: str) -> str:
    """Rule 9. POSIX relpath from root; absolute if genuinely outside."""
    if not path:
        return ''
    try:
        rel = os.path.relpath(os.path.abspath(path), os.path.abspath(root))
    except ValueError:  # different drive on Windows
        return path.replace(os.sep, '/')
    if rel.startswith(os.pardir):
        # Outside the corpus. Keep it whole so it is obviously not client code.
        return os.path.abspath(path).replace(os.sep, '/')
    return rel.replace(os.sep, '/')


def module_qualname(rel: str) -> str:
    """`pkg/mod.py` -> `pkg.mod`; `pkg/__init__.py` -> `pkg`."""
    if rel.endswith('.py'):
        rel = rel[:-3]
    parts = [p for p in rel.split('/') if p]
    if parts and parts[-1] == '__init__':
        parts.pop()
    return '.'.join(parts)


@dataclass(frozen=True, order=True)
class Anchor:
    """Rule 1. The identity of a callable: where its defining keyword is.

    `native` carries a native callee (Rule 7), which has no file and no line.
    """

    file: str
    line: int
    native: str = ''

    @staticmethod
    def native_of(name: str) -> 'Anchor':
        return Anchor('', 0, NATIVE_PREFIX + (name or '?'))

    @property
    def is_native(self) -> bool:
        return bool(self.native)

    def key(self) -> str:
        return self.native if self.native else f'{self.file}:{self.line}'

    def __str__(self) -> str:  # pragma: no cover - display only
        return self.key()


class DecoratorIndex:
    """Per-file AST index that folds runtime lines onto def-keyword lines.

    Built ONCE per file and reused. Holds:
      * decorator-first-line  -> def-keyword line   (Rule 1)
      * def-keyword line      -> qualname, kind     (Rule 8)
      * def-keyword line      -> enclosing def line (Rule 3 folding)

    Parsing only; the file is never imported or executed.
    """

    def __init__(self, source: str, rel: str):
        self.rel = rel
        self.module = module_qualname(rel)
        self.fold_line: Dict[int, int] = {}
        self.qualname: Dict[int, str] = {}
        self.kind: Dict[int, str] = {}
        self.parent: Dict[int, Optional[int]] = {}
        self.class_lines: Dict[int, str] = {}
        # def-line -> (start, end) source span, so a line that is NOT a def line
        # (a comprehension body, an arbitrary statement) can still find the
        # function that lexically contains it. Rule 3 needs this: a `<listcomp>`
        # code object's co_firstlineno is the line the comprehension is written
        # on, which is a statement line, not a def line.
        self.span: Dict[int, tuple] = {}
        try:
            tree = ast.parse(source, filename=rel)
        except SyntaxError:
            self._ok = False
            return
        self._ok = True
        self._walk(tree, [], None)

    @property
    def parsed(self) -> bool:
        return self._ok

    def _walk(self, node: ast.AST, stack, enclosing_def: Optional[int]) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                line = child.lineno
                qual = '.'.join(stack + [child.name])
                self.qualname[line] = qual
                self.kind[line] = 'async_function' if isinstance(child, ast.AsyncFunctionDef) else 'function'
                self.parent[line] = enclosing_def
                self.span[line] = (line, getattr(child, 'end_lineno', line) or line)
                # Rule 1: every decorator line folds onto the def line, so a
                # runtime co_firstlineno landing on any of them normalises here.
                for dec in child.decorator_list:
                    for ln in range(dec.lineno, getattr(dec, 'end_lineno', dec.lineno) + 1):
                        self.fold_line[ln] = line
                self._walk(child, stack + [child.name, '<locals>'], line)
            elif isinstance(child, ast.ClassDef):
                line = child.lineno
                qual = '.'.join(stack + [child.name])
                self.qualname[line] = qual
                self.kind[line] = 'class'
                self.parent[line] = enclosing_def
                self.class_lines[line] = qual
                for dec in child.decorator_list:
                    for ln in range(dec.lineno, getattr(dec, 'end_lineno', dec.lineno) + 1):
                        self.fold_line[ln] = line
                self._walk(child, stack + [child.name], enclosing_def)
            elif isinstance(child, ast.Lambda):
                line = child.lineno
                self.qualname.setdefault(line, '.'.join(stack + ['<lambda>']))
                self.kind.setdefault(line, 'lambda')
                self.parent.setdefault(line, enclosing_def)
                self.span.setdefault(line, (line, getattr(child, 'end_lineno', line) or line))
                self._walk(child, stack + ['<lambda>', '<locals>'], line)
            else:
                self._walk(child, stack, enclosing_def)

    def anchor_for(self, line: int) -> int:
        """Rule 1: fold a decorator line onto its `def` line. Identity otherwise."""
        return self.fold_line.get(line, line)

    def enclosing_def(self, line: int) -> Optional[int]:
        """Innermost `def`/`lambda` whose source span contains `line`.

        `None` at module level. Used by Rule 3 to fold a comprehension scope
        into the function that lexically contains it -- the comprehension's own
        line is a statement line, so the def-line-keyed parent map cannot answer
        this and returned module scope instead, which silently attributed every
        comprehension call to `<module>`.
        """
        best = None
        for dline, (start, end) in self.span.items():
            if start <= line <= end:
                if best is None or start > self.span[best][0]:
                    best = dline
        return best

    def qual_for(self, line: int) -> str:
        """Rule 8: fully-qualified name for a def-keyword line."""
        if line == 0:
            return f'{self.module}.{MODULE_SCOPE}'
        q = self.qualname.get(line)
        if q is None:
            return f'{self.module}.<line{line}>'
        return f'{self.module}.{q}'


class Normalizer:
    """Applies every rule above. One instance per corpus root; caches per file.

    Consumers (`python-callsite-validate`, `python-library-linking`, the client
    suite) must all go through this object rather than folding by hand.
    """

    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self._index: Dict[str, DecoratorIndex] = {}

    # ── file helpers ────────────────────────────────────────────────────────
    def rel(self, path: str) -> str:
        return relpath(path, self.root)

    def inside(self, path: Optional[str]) -> bool:
        """Client code, i.e. inside the corpus root. Scope gate for this suite."""
        if not path:
            return False
        if path.startswith('<'):          # <string>, <frozen importlib...>
            return False
        try:
            ap = os.path.abspath(path)
        except (TypeError, ValueError):
            return False
        return ap == self.root or ap.startswith(self.root + os.sep)

    def index(self, path: str) -> Optional[DecoratorIndex]:
        rel = self.rel(path)
        if rel not in self._index:
            try:
                with open(os.path.join(self.root, rel), 'rb') as fh:
                    src = fh.read().decode('utf-8', 'replace')
            except OSError:
                self._index[rel] = None
                return None
            idx = DecoratorIndex(src, rel)
            self._index[rel] = idx if idx.parsed else None
        return self._index[rel]

    # ── the rules ───────────────────────────────────────────────────────────
    def anchor(self, filename: Optional[str], line: int) -> Optional[Anchor]:
        """Rules 1 + 9. `None` when the file is outside the corpus (not client)."""
        if not self.inside(filename):
            return None
        rel = self.rel(filename)
        idx = self.index(filename)
        return Anchor(rel, idx.anchor_for(line) if idx else line)

    def anchor_of_code(self, code) -> Optional[Anchor]:
        """Anchor of a code object, with Rules 3, 5 and 6 applied."""
        if code is None:
            return None
        if code.co_name == '<module>':
            if not self.inside(code.co_filename):
                return None
            return Anchor(self.rel(code.co_filename), 0)     # Rule 5
        return self.anchor(code.co_filename, code.co_firstlineno)

    def anchor_of_function(self, func) -> Optional[Anchor]:
        """Anchor of a live function object. Caller must unwrap first (Rule 2)."""
        code = getattr(func, '__code__', None)
        if code is None:
            return None
        return self.anchor_of_code(code)

    def fold_scope(self, anchor: Optional[Anchor], scope_name: str) -> Optional[Anchor]:
        """Rule 3. A comprehension scope resolves to its lexical parent."""
        if anchor is None or scope_name not in COMPREHENSION_SCOPES:
            return anchor
        idx = self.index(os.path.join(self.root, anchor.file))
        if idx is None:
            return anchor
        enclosing = idx.enclosing_def(anchor.line)
        if enclosing is None:
            return Anchor(anchor.file, 0)       # Rule 5: module level
        return Anchor(anchor.file, enclosing)

    def qualname(self, anchor: Optional[Anchor]) -> str:
        """Rule 8. Display name for an anchor."""
        if anchor is None:
            return '?'
        if anchor.is_native:
            return anchor.native
        idx = self.index(os.path.join(self.root, anchor.file))
        mod = module_qualname(anchor.file)
        if idx is None:
            return f'{mod}.<line{anchor.line}>'
        if anchor.line == 0:
            return f'{mod}.{MODULE_SCOPE}'          # Rule 5
        if anchor.line in idx.class_lines:          # Rule 6
            return f'{mod}.{idx.class_lines[anchor.line]}.{CLASS_BODY_SCOPE}'
        return idx.qual_for(anchor.line)

    def kind(self, anchor: Optional[Anchor]) -> str:
        if anchor is None:
            return 'unknown'
        if anchor.is_native:
            return 'native'
        idx = self.index(os.path.join(self.root, anchor.file))
        if idx is None:
            return 'unknown'
        if anchor.line == 0:
            return 'module'
        if anchor.line in idx.class_lines:
            return 'classbody'
        return idx.kind.get(anchor.line, 'unknown')


def ir_anchor_line(idx: Optional[DecoratorIndex], line: int, method_kind: str = '') -> int:
    """Fold an IR-reported startLine onto a canonical anchor line.

    Applied to the ENGINE/IR side so both sides fold identically:
      * Rule 5 -- a MODULE_INITIALIZER row anchors at line 0, not at its
        reported startLine, which collides with a class on line 1.
      * Rule 1 -- a decorator line folds onto its `def` line. The parser already
        reports the `def` line, so this is the identity today. It is written
        anyway: if the parser ever changes, the oracle must not silently start
        manufacturing defects.
    """
    if method_kind == 'MODULE_INITIALIZER':
        return 0
    if idx is None:
        return line
    return idx.anchor_for(line)
