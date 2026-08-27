"""01 -- plain calls. Module function, nested function, closure over a free variable.

INTENT: the three ways a callee name can be bound without any receiver at all.
`symtable` classifies them differently -- GLOBAL, LOCAL, FREE -- and that binding
class is the whole of the resolution problem here. Nothing in this file depends
on a type, so an engine that cannot do these cannot do anything.
"""


def leaf(n):
    return n + 1


def module_function(n):
    # GLOBAL: `leaf` is a module-level binding, resolvable without running.
    return leaf(n)


def with_nested(n):
    def inner(k):
        # The nested function is a separate code object with its own anchor.
        return leaf(k) * 2

    # LOCAL: `inner` is a local binding holding a function.
    return inner(n)


def make_adder(base):
    def add(n):
        # FREE: `base` is a closure cell. `helper` is still GLOBAL from here --
        # a nested scope does not change how a module-level name binds.
        return helper(base) + n

    return add


def helper(v):
    return v * 10


def main():
    print(module_function(1))
    print(with_nested(2))
    adder = make_adder(3)
    # LOCAL holding a closure: only tier 4 can say which function object this is.
    print(adder(4))


if __name__ == "__main__":
    main()
