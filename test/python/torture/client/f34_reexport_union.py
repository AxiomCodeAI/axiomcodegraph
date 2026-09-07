"""FAMILY 34 — a module member bound by ASSIGNMENT (issue #222).

`module_member_method` had a clause for a top-level `def` and three for import
re-exports, and none for a name bound by assignment at module scope. So
`alias = slow` in a facade made `from rxfacade import alias; alias(21)` a declared
unknown, and the multi-write case #222 reports is the second half of the same hole.

No single-write gate, deliberately: the optional-dependency idiom binds one name
from two origins and BOTH are reachable. Only one of them runs on any given pass,
so the other is `wide` — a sound-set member tier 4 did not observe — which is the
correct classification and not a shortfall.
"""
from rxfacade import alias, chosen, picked
from rxlib import slow


def a_single_assignment_reexport() -> int:
    # was ambiguous_unknown: a module member bound by assignment was not a member
    return alias(21)


def the_optional_dependency_idiom() -> int:
    # was known_edge -> rxaccel.boost, with rxlib.fallback in no row at all, even
    # though `except ImportError: chosen = fallback` is reachable whenever the
    # accelerator is absent. Now multi_inferred over both.
    return chosen(21)


def two_assignments_to_one_name() -> int:
    # was ambiguous_unknown — both targets lost rather than unioned
    return picked(21)


def a_def_reexport_control() -> int:
    # The shape that always worked: a top-level `def` reached through its own module.
    # Here so a regression in the existing clause is distinguishable from one in the
    # new clause.
    return slow(21)


def drive() -> str:
    parts = []
    parts.append(str(a_single_assignment_reexport()))
    parts.append(str(the_optional_dependency_idiom()))
    parts.append(str(two_assignments_to_one_name()))
    parts.append(str(a_def_reexport_control()))
    return " ".join(parts)
