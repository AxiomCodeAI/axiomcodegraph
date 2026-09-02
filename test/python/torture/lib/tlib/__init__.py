"""Re-export surface. Both forms, because they resolve by different rules."""
from .shapes import Base, Circle, Mid, Square, Leaf, DiamondL, DiamondR, Diamond
from .callables import Doubler, Tripler, Registry, make_adder, module_fn, passthrough
from .generics import Box, IntBox, StrBox, RawBox, Payload, Marker
from .descriptors import Config, Factory
from .decorated import wrapped_fn, retry, tagged
# WILDCARD, and the only one in the suite: binds Exported alone, because exports.py
# declares __all__ = ["Exported"]. NotExported and _Private must NOT become tlib members.
from .exports import *

__all__ = [
    "Base", "Mid", "Leaf", "Square", "Circle", "DiamondL", "DiamondR", "Diamond",
    "Doubler", "Tripler", "Registry", "make_adder", "module_fn", "passthrough",
    "Box", "IntBox", "StrBox", "RawBox", "Payload", "Marker",
    "Config", "Factory", "wrapped_fn", "retry", "tagged", "Exported",
]
