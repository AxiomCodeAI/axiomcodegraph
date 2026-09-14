"""09 -- *args / **kwargs passthrough (`isArgsKwargsPassthrough`).

INTENT: a passthrough forwards its whole argument list to another callable, so
the ARGUMENT SHAPE at the outer call site tells you nothing about the inner one.
The IR carries a flag for this (`isArgsKwargsPassthrough` on py_method), and it
is exactly the shape that makes `CALL_FUNCTION_EX` appear in the bytecode instead
of the ordinary `CALL_FUNCTION` -- a different opcode with a different stack
layout, which is why tier 1 handles it separately.

Three depths: a direct forward, a forward through a stored callable, and a
forward that adds a keyword on the way through.
"""


def target(a, b, c=0, **rest):
    return a + b + c + len(rest)


def forward(*args, **kwargs):
    # Pure passthrough. CALL_FUNCTION_EX: the arguments are a tuple and a dict,
    # not individual stack slots.
    return target(*args, **kwargs)


def forward_twice(*args, **kwargs):
    # Passthrough to a passthrough.
    return forward(*args, **kwargs)


def forward_augmented(*args, **kwargs):
    # Still a passthrough, but the callee's keyword set is not the caller's.
    return target(*args, c=99, **kwargs)


class Delegator:
    def __init__(self, fn):
        self.fn = fn

    def __call__(self, *args, **kwargs):
        # Forwarding through an attribute: the target is not named here at all.
        return self.fn(*args, **kwargs)


def main():
    print(forward(1, 2))
    print(forward_twice(1, 2, c=3))
    print(forward_augmented(1, 2, extra=5))
    print(Delegator(target)(1, 2, c=4))


if __name__ == "__main__":
    main()
