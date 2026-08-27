"""12 -- BLIND SPOTS. Every site here MUST come out declared-unknown or native.

INTENT: a suite that only tests what works is not a suite. These are the
constructs where no static answer exists, and the required behaviour is to say
so -- never to drop the site, and never to fabricate a target.

  getattr           the method name is COMPUTED. Tiers 1-3 cannot see it; tier 4
                    can watch it happen. That gap is the honest limit of static
                    analysis, not a bug to be fixed.
  monkey-patching   the class is mutated after definition, so the `def` that
                    runs is not the one the class body declared.
  metaclass         the method is INSTALLED BY THE METACLASS. There is a `def`
                    for it in the metaclass, but no `def` in the class that
                    ends up owning it.
  exec-synthesised  the `attr` shape: __init__ is BUILT AT RUNTIME with exec and
                    has no `def` in this source at all. Tier 1 sees no method;
                    tiers 3 and 4 do. An oracle that mishandles this looks like
                    an engine bug, which is why it is pinned here.
  C extension       `math.sqrt` has no Python source and no code object with a
                    filename, so it can never join to an IR method. It must read
                    boundary/native; a "resolved" one is a fabrication.
"""
import math


class Target:
    def real_method(self):
        return "real"

    def replaced_later(self):
        return "original"


def patched(self):
    return "patched"


# Monkey-patching: after this line, `Target.replaced_later` is a different
# function from the one written in the class body above.
Target.replaced_later = patched


class Installer(type):
    def __new__(mcls, name, bases, ns):
        # The method below exists only because the metaclass put it here.
        ns["injected"] = lambda self: "injected"
        return super().__new__(mcls, name, bases, ns)


class Built(metaclass=Installer):
    pass


class Synthesised:
    """The `attr` shape: a method with NO `def` anywhere in this file."""


_src = "def __init__(self, value):\n    self.value = value\n"
_ns = {}
exec(_src, _ns)
Synthesised.__init__ = _ns["__init__"]


def call_by_computed_name(obj, which):
    # The name is data. Nothing static can resolve this.
    return getattr(obj, which)()


def main():
    t = Target()
    print(call_by_computed_name(t, "real_method"))
    print(t.replaced_later())
    print(Built().injected())
    print(Synthesised(7).value)
    # C extension: no source, no code object, no join.
    print(math.sqrt(16))


if __name__ == "__main__":
    main()
