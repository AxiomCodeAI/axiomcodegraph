"""FAMILY 21 — a module alias imported from a package.

`dp` names the submodule `aliaspkg.deep`, not the package `aliaspkg`. Getting that first
hop wrong invalidates every attribute on it, however well the rest of the chain resolves --
here the class itself arrives through a further wildcard re-export from `deep.impl`.
"""
from aliaspkg import dp


def construct_through_alias() -> str:
    return dp.Node().label()


def call_function_through_alias() -> str:
    return dp.build_node().label()
