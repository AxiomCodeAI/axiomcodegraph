"""11 -- from-import, alias, relative import, and a SIMPLE-NAME COLLISION.

INTENT: this is the case a name-keyed resolver gets wrong (Java's case 16
analog). Three modules define `process`, and every call below spells a name that
is `process` or an alias of it. Resolving by simple name alone gives three
candidates for each site and no way to choose; the module a name was IMPORTED
FROM is the only thing that decides it, and that is recorded in the import table,
not at the call site.

`.claude/python/engine.md` records why this matters beyond aesthetics:
`resolvedCalleeHash` is only meaningful inside a single parser run, so
cross-module linking must go through NAMES -- which makes name collisions the
exact failure mode the resolution layer has to survive.
"""
from alpha import process
from beta import process as beta_process
import pkg.core
from pkg.util import via_relative, via_module_attr
import alpha as a_alias


def call_bare():
    # `process` here is alpha.process. Not beta's, not pkg.core's.
    return process(1)


def call_aliased():
    # The SAME simple name, bound to a different function by an alias.
    return beta_process(2)


def call_qualified():
    # A third `process`, reached through the package.
    return pkg.core.process(3)


def call_module_alias():
    return a_alias.only_alpha()


def main():
    print(call_bare())
    print(call_aliased())
    print(call_qualified())
    print(call_module_alias())
    print(via_relative(4))
    print(via_module_attr(5))


if __name__ == "__main__":
    main()
