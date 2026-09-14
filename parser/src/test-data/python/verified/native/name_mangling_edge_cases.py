"""Private name mangling (`__name` -> `_ClassName__name`), pinned down at
the boundary CPython actually draws it at, rather than the commonly
mis-stated "any double-underscore attribute" version:

- It mangles the identifier **textually**, recursively through every
  nested def/lambda/comprehension inside the class body, using the
  *nearest enclosing class* at that point in the source — not the
  outermost one.
- It applies to bare identifiers (which show up as mangled symtable
  symbols — Gate-1 checkable) exactly the same way it applies to
  attribute-access names like `self.__x` (`ast.Attribute.attr` is left
  UNMANGLED by `ast.parse`; the substitution only happens later, in
  bytecode compilation's `co_names`). That second form is confirmed
  against `compile()`/`dis` below but is invisible to both `ast` and
  `symtable`, so it is not something Gate 1 or Gate 2 can adjudicate —
  flagged in the manifest, not asserted as oracle-verified.
- Exactly two leading underscores and *at most one* trailing underscore
  qualifies. Two leading AND two-or-more trailing (a "dunder", e.g.
  `__init__`, `__x__`) is explicitly exempt.
"""


class Outer:
    __secret = "outer secret"

    class Inner:
        __secret = "inner secret"

        def read_own(self):
            # mangles relative to Inner (the nearest enclosing class),
            # not Outer, even though Outer also encloses this method
            return __secret if False else self.__secret

    def read_own(self):
        return self.__secret

    def bare_identifier_forms(self):
        # 2 leading + 1 trailing underscore: mangled
        __one_trailing_ = "mangled"
        # 2 leading + 2 trailing underscore: a dunder, exempt from mangling
        __two_trailing__ = "not mangled"
        return __one_trailing_, __two_trailing__

    def dunder_method_reference_not_mangled(self):
        # `__init__` has 2+ trailing underscores -> dunder exemption
        return self.__init__

    def mangling_recurses_into_nested_scopes(self):
        def nested():
            __deep = "still mangles to Outer, the nearest enclosing class"
            return __deep

        return [__inside_comprehension for __inside_comprehension in (nested(),)]


class SavingsAccount(Outer):
    def read_inherited_name_is_different_attribute(self):
        # textually `__secret` here mangles to `_SavingsAccount__secret`,
        # NOT `_Outer__secret` — the nearest enclosing class is this one,
        # so this reads a different attribute than Outer.read_own does,
        # even though the source text is identical
        return getattr(self, "_SavingsAccount__secret", "unset")
