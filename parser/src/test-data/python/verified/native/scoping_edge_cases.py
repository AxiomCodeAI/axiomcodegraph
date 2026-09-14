"""Scope-resolution edge cases that are easy for a hand-rolled resolver to
get wrong even though CPython's own rule is simple and uniform: class
bodies are *never* an enclosing scope for anything nested inside them
(methods, comprehensions, nested classes) — only module and function
scopes participate in that chain. Every case here is confirmed against
`compile()`/`symtable` before being staged; several are runtime NameErrors
that are nonetheless perfectly valid, parseable syntax.
"""

module_x = "module-level x"


def shadowed_default(module_x=module_x):
    # The default value `module_x` is looked up where the `def` statement
    # executes (module scope), BEFORE the parameter binding of the same
    # name exists. Inside the body, `module_x` is the parameter (LOCAL).
    return module_x


class ClassScopeIsInvisibleToComprehensions:
    """The single most common Python scoping surprise."""

    data = [1, 2, 3]

    # The *outermost* iterable of a comprehension is evaluated directly in
    # the enclosing (here: class-body) scope, so this reference to `data`
    # is a normal class-body read — no separate scope involved yet.
    doubled = [item * 2 for item in data]

    # Everything else in a comprehension — including a second `data`
    # reference in the body — runs in the comprehension's OWN function
    # scope, and that scope's lookup chain skips class scopes entirely.
    # `data` here resolves as a free/global lookup, NOT as the class
    # attribute two lines up, and raises NameError at class-creation time.
    # It is still syntactically valid and must be modeled as a non-class
    # binding.
    scaled = [item * data[0] for item in range(3)]


class ClassScopeIsInvisibleToMethods:
    label = "class attribute"

    def read_label_wrong(self):
        # Same rule, one level down: a method is a function scope nested
        # directly under the class's *enclosing* scope (module here), not
        # under the class body. `label` is unresolved in the method and
        # falls through to global/builtin lookup, not the class attribute.
        try:
            return label
        except NameError:
            return "no such global"

    def read_label_right(self):
        # The only correct way to reach a class attribute from a method.
        return self.label


class NestedClassInsideFunction:
    pass


def outer_with_nested_class():
    tally = 0

    class Counter:
        # A class body sits between `outer_with_nested_class` and
        # `Counter.increment` in the nesting chain, but `nonlocal` still
        # reaches straight through it to the enclosing *function* scope —
        # class scopes are transparent to nonlocal/global resolution.
        def increment(self):
            nonlocal tally
            tally += 1
            return tally

    return Counter(), (lambda: tally)


def del_nonlocal_and_global():
    global module_x
    local_only = "will be deleted"
    del local_only

    tracked = 0

    def inner():
        # `nonlocal` requires the enclosing function to bind `tracked`
        # somewhere in its own body (it does, above) — deleting a
        # nonlocal-declared name is legal and distinct from deleting a
        # plain local.
        nonlocal tracked
        tracked += 1
        del tracked
        return "done"

    del module_x
    return inner


def default_uses_walrus_at_def_time(seed=(computed := 21 * 2)):
    # The walrus in a default-value position runs once, at def-time, in
    # the enclosing scope — `computed` becomes a binding of this module,
    # not of default_uses_walrus_at_def_time.
    return seed, computed
