"""FAMILY 07 — import & re-export forms. Each resolves by a DIFFERENT rule, and
the 2026-08-30 defect was that two of them disagreed for the same class."""
import tlib
import tlib.shapes as shp
from tlib import Square as Sq
from tlib.shapes import Circle


def via_package_attribute() -> str:
    return tlib.Square().name()         # attribute on the package


def via_module_alias() -> str:
    return shp.Mid().name()             # attribute on an aliased submodule


def via_from_reexport() -> str:
    return Sq().name()                  # from-import of a RE-EXPORTED name (aliased)


def via_from_declaring_module() -> str:
    return Circle().name()              # from-import from the declaring module


def via_module_function() -> int:
    return tlib.module_fn(2)
