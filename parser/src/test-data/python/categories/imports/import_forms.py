"""Every import shape the schema's importKind enumerates."""
import os
import os.path
import os as operating_system
from os import sep
from os import sep as separator
from . import pkg
from .pkg import leaf
from .pkg.leaf import Leaf, helper
from .pkg.leaf import Leaf as Renamed

if True:
    import json


def uses_conditional() -> object:
    # Referenced, not called: the fact under test is the py_import row. Calling
    # into the stdlib would add an unresolvable site and cost this file its place
    # in the golden corpus without testing anything more about imports.
    return json


def exercise() -> int:
    return helper() + len(Leaf().label()) + len(Renamed().label()) + len(sep) + len(separator)
