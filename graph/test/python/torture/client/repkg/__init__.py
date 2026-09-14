"""A package that presents a flat public API over submodules — how most projects do it.

`from .inner import *` is a WILDCARD re-export. The parser resolves the wildcard's source
module but not the members arriving through it, so a package analysed on its own lost
every class it exposes this way.
"""
from .inner import *          # noqa: F401,F403
from . import inner as alias  # a submodule bound under a short alias
