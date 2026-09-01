"""FAMILY 19 — a class reached through a package's wildcard re-export.

The re-export rules were "lib"-only, on the premise that a client re-export is already
resolved by the parser. That holds for a MEMBER re-export and not for a WILDCARD: the
parser resolves the wildcard's source module but not the members arriving through it.

A package analysed on its own -- which is how a library is measured, and how most
projects present a public API -- therefore lost every class exposed this way.
"""
import repkg
from repkg import alias


def via_package_attribute() -> str:
    # two wildcard hops: repkg <- repkg.inner <- repkg.inner.leaf
    return repkg.Widget().emit()


def via_reexported_function() -> str:
    return repkg.make_widget().emit()


def via_submodule_alias() -> str:
    # `from . import inner as alias` — a submodule bound under a short name
    return alias.Widget().emit()
