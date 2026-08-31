"""from .sibling import <name> — the shape that had no target.

`packageOrTypeName` is `_gen` while the module's qualifiedName is `pkgmod._gen`; the
rule that matched one against the other could never fire."""
from ._gen import each, each_first, plain


def run_generator(items):
    return [v for v in each(items)]          # relative import of a GENERATOR


def run_generator_in_for(items):
    total = 0
    for v in each_first(items):              # same, in for-iterable position
        total += v
    return total


def run_plain(items):
    return plain(items)                      # control: resolves via the FK path
