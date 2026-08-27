"""Relative import. `from .core import engine` binds a name in THIS module's
globals that points at a function defined in another file."""
from .core import engine
from . import core


def via_relative(v):
    return engine(v)


def via_module_attr(v):
    # Same target, reached as a module attribute instead of a bound name.
    return core.engine(v)
