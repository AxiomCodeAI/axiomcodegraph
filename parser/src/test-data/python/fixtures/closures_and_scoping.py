"""Scope/binding semantics that Gate 1 (symtable set-equality) adjudicates
directly: nonlocal across two closure levels, global written from inside a
class body, comprehension scope isolation (with CPython's synthetic `.0`
iterator parameter), walrus escaping a comprehension into the enclosing
function scope, and late-binding closures captured in a loop.
"""

counter = 0


def make_counter():
    count = 0

    def increment():
        # `nonlocal` one level up: binds `count` in make_counter's scope
        nonlocal count

        def bump_twice():
            # `nonlocal` reaching *through* increment's scope to make_counter's
            # `count` — two closure levels up, not one
            nonlocal count
            count += 2
            return count

        count += 1
        return count, bump_twice()

    return increment


class Registry:
    # `global` declared inside a class body: the class-body scope itself
    # declares it, not a method — a shape symtable models differently from
    # a function-level global statement
    global counter

    def bump(self):
        global counter
        counter += 1
        return counter


def comprehension_scopes(values):
    x = "outer x, must not leak into or from the comprehensions"

    # Each of these introduces its own scope. The bound name `x` inside each
    # comprehension is local to that comprehension's scope and must not
    # collide with the outer `x`, nor with each other.
    squares = [x * x for x in values]
    unique = {x for x in values if x > 0}
    doubled = {x: x * 2 for x in values}
    gen = (x + 1 for x in values)

    # walrus inside a comprehension binds in the *enclosing* function scope,
    # not the comprehension's own scope — `last_seen` must appear as a
    # binding of comprehension_scopes, not of the listcomp
    filtered = [y for y in values if (last_seen := y) > 0]

    return squares, unique, doubled, list(gen), filtered, last_seen, x


def late_binding_closures():
    # Classic late-binding trap: all three closures share the *same*
    # binding for `i` (the loop variable), so this is one binding referenced
    # by three separate function scopes as a free variable.
    callbacks = []
    for i in range(3):
        callbacks.append(lambda: i)

    # The fix rebinds `i` as a default-argument value at definition time,
    # which makes it a parameter binding of each lambda instead of a free
    # variable resolving to the loop's binding.
    fixed_callbacks = []
    for i in range(3):
        fixed_callbacks.append(lambda i=i: i)

    return callbacks, fixed_callbacks
