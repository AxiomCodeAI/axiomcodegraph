"""A module with a static __all__, for the wildcard re-export guard (issue #105).

`from .exports import *` in tlib/__init__.py binds ONLY the names in __all__. The other
two are unreachable as `tlib.<name>` at runtime -- NotExported raises AttributeError, and
_Private is excluded by the underscore rule even when no __all__ exists.
"""

__all__ = ["Exported"]


class Exported:
    def run(self) -> str:
        return "exported"


class NotExported:
    """Defined here, absent from __all__ -- `tlib.NotExported` does not exist."""

    def run(self) -> str:
        return "not-exported"


class _Private:
    """Underscore-prefixed -- excluded by `import *` regardless of __all__."""

    def run(self) -> str:
        return "private"
