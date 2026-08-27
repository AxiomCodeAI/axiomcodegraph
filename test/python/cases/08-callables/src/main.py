"""08 -- callables that are not `def`s: __call__, partial, lambda in a dict,
a function stored on an attribute.

INTENT: every one of these is a call site whose callee is a VALUE, not a name.
The bytecode spells them all the same way -- something is loaded, then called --
so tier 1 cannot tell them apart and only the live object can.

  __call__    the callee is an instance; the function is on its TYPE
  partial     functools.partial exposes `.func`, so CPython can name the target
  lambda      stored in a dict, reached by subscript: no name at the call site
  attribute   a plain function assigned to an instance attribute, which does NOT
              go through the descriptor protocol and so is not a bound method
"""
import functools


class Multiplier:
    def __init__(self, factor):
        self.factor = factor

    def __call__(self, n):
        # Invoked as `m(5)`. The call site names `m`, never `__call__`.
        return n * self.factor


def add(a, b):
    return a + b


class Holder:
    def __init__(self):
        # A function on an INSTANCE attribute. Not a method: no `self` is bound.
        self.op = add

    def use(self):
        return self.op(1, 2)


TABLE = {
    # A lambda reached by subscript. There is no name to resolve.
    "double": lambda n: n * 2,
    "negate": lambda n: -n,
}


def main():
    m = Multiplier(3)
    print(m(5))

    add_ten = functools.partial(add, 10)
    print(add_ten(5))

    print(TABLE["double"](21))
    print(Holder().use())


if __name__ == "__main__":
    main()
