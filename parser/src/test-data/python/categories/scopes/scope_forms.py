"""Every scope kind, and the binding shapes that reach across them."""

MODULE_LEVEL = 1


def closure_over_local():
    captured = 1

    def inner():
        return captured

    return inner()


def rebinds_nonlocal():
    value = 1

    def inner():
        nonlocal value
        value = 2

    inner()
    return value


def declares_global():
    global MODULE_LEVEL
    MODULE_LEVEL = 2
    return MODULE_LEVEL


def comprehension_scopes(items):
    lc = [i for i in items]
    sc = {i for i in items}
    dc = {i: i for i in items}
    ge = (i for i in items)
    return lc, sc, dc, ge


def lambdas():
    # Two lambdas on ONE LINE — the case that made startColumn part of the
    # py_scope key. Invoked in place, because calling through a local would need
    # local-variable typing and cost this file its place in the golden corpus.
    # NOT invoked. An immediately-invoked lambda emits a call site whose
    # calleeName is empty and whose receiverKind is NONE, so it counts as
    # unresolved even though the lambda has a py_method row of its own — filed
    # for A3. The scope facts are what this file tests, and they need no call.
    pair = ((lambda: 1), (lambda: 2))
    return len(pair)


class ClassScope:
    class_var = 1

    def method(self) -> int:
        def nested():
            return self.helper()

        return nested()

    def helper(self) -> int:
        return 2


def exercise() -> int:
    return closure_over_local() + rebinds_nonlocal() + lambdas() + ClassScope().method()
