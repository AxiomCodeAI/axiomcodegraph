"""07 -- decorators: pass-through, target-replacing, functools.wraps, stacked.

INTENT: decorators REBIND NAMES, so the name at a call site need not denote the
function written under it. Four shapes, each failing differently:

  passthrough   returns the target unchanged -- the name still means the `def`
  replacing     returns a DIFFERENT function -- the `def` is never called at all
  wrapping      functools.wraps sets __wrapped__, so inspect.unwrap recovers the
                target and tier 4 shows caller -> wrapper -> body
  stacked       APPLICATION ORDER IS BOTTOM-UP: @outer over @inner means
                outer(inner(f)), so inner wraps the body and outer wraps inner

The measured trap this case exists to catch: a decorated function's
`__code__.co_firstlineno` points INSIDE THE DECORATOR, not at the `def`, while
`__qualname__` still reads correctly. Introspected naively, every edge here is
attributed to the wrong source line and a correct engine looks broken.

`route` is the click-style idiom -- dispatch entirely through a decorator
registry, where the call site is `handler()` on a value pulled out of a dict that
a decorator populated at import time.
"""
import functools

REGISTRY = {}


def passthrough(fn):
    # Returns the target itself. The name still means the `def` below it.
    return fn


def replacing(fn):
    # Returns something else entirely; `fn` is never called.
    def substitute(*args, **kwargs):
        return "substituted"

    return substitute


def wrapping(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        # The wrapper is a REAL CALLEE, not a detail to unwrap away.
        return "wrapped:" + str(fn(*args, **kwargs))

    return wrapper


def inner_deco(fn):
    @functools.wraps(fn)
    def inner_w(*args, **kwargs):
        return "inner(" + str(fn(*args, **kwargs)) + ")"

    return inner_w


def outer_deco(fn):
    @functools.wraps(fn)
    def outer_w(*args, **kwargs):
        return "outer[" + str(fn(*args, **kwargs)) + "]"

    return outer_w


def route(name):
    # click-style: the decorator registers, and dispatch happens through the
    # registry rather than through any name written at the call site.
    def register(fn):
        REGISTRY[name] = fn
        return fn

    return register


@passthrough
def plain():
    return "plain"


@replacing
def never_runs():
    return "unreachable"


@wrapping
def wrapped_target():
    return "target"


@outer_deco
@inner_deco
def stacked():
    # Applied bottom-up: outer_deco(inner_deco(stacked)).
    return "core"


@route("go")
def handler():
    return "handled"


def main():
    print(plain())
    print(never_runs())
    print(wrapped_target())
    print(stacked())
    # Dispatch through the registry: no name here denotes `handler`.
    print(REGISTRY["go"]())


if __name__ == "__main__":
    main()
