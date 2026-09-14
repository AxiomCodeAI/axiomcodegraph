"""A package that binds its own submodule under a short alias, using the ABSOLUTE
self-referential form -- `from <this package> import <submodule> as <alias>` -- which is
how large projects present a compact public API.

A client then writes `from aliaspkg import dp`. The import resolves to the SOURCE PACKAGE
rather than to the submodule the name denotes, so `dp` was typed as `aliaspkg` and every
attribute on it was looked up in the wrong module.
"""
from aliaspkg import deep as dp    # noqa: F401
