"""FAMILY 38 — a NESTED class is reachable through its owner, and not by its bare name.

`module_member_type` read `type_module`, which is `py_type.pyModuleLinkHash` — a column
EVERY type carries, nested and function-local ones included. So a class nested in another
class was a member of its module under its short name, and the two halves failed in
opposite directions:

    Outer.Inner()          the ONLY spelling Python gives it   -> no answer at all
    x: Inner               can only mean the top-level Inner    -> all three Inners

MEASURED, five open-source projects: 8,755 classes are nested in another class (192 more
are local to a function), and 6,321 of those collide with another type of the same short
name in the same module. `Meta` alone is declared 1,107 times in one project, which is why
`nestmod` carries the `class Meta:` shape as well as the synthetic collision.

`method_top_level` in the same file already had to make this exact distinction for
functions, and says why: `py_method.pyTypeLinkHash` is empty for a nested def too, so the
module-level test alone admits every closure. Types had no such guard.

WHAT EACH CASE IS FOR. `qualified` is the spelling that resolved to nothing. `bare_*` are
the three routes that over-resolved — an annotation, a module attribute, and a field — and
each must now land on exactly ONE candidate, which is what makes them `known_edge` rather
than a three-way `multi_inferred`. `deep` is two hops, because the rule recurses on itself
and one level would not show that. `meta_*` is the real-world shape, and it is two
DIFFERENT nested classes with the same name reached through different owners, so a rule
that returned "some Meta" would pass the single-owner cases and fail here.

`owner_constructs_its_own_nested` is the same construction written inside the owner,
which is how the idiom usually appears in real code.

`top_level_still_resolves` is the control: the guard must not cost the ordinary case.
"""
from nestmod import Conditional, Config, Guarded, Inner, Outer, Profile

_BAG = {}


def _from_bag(k):
    return _BAG[k]


def qualified() -> str:
    return Outer.Inner().run()


def deep() -> str:
    # two nesting hops: the rule has to recurse on its own output
    return Outer.Middle.Deep().run()


def bare_annotation(x: Inner) -> str:
    return x.run()


def bare_field() -> str:
    return Holder().v.run()


class Holder:
    def __init__(self) -> None:
        self.v: Inner = _from_bag("v")


def meta_of_config() -> str:
    return Config.Meta().label()


def meta_of_profile() -> str:
    # the SAME short name through a different owner — must not collapse into one answer
    return Profile.Meta().label()


def top_level_still_resolves() -> str:
    # CONTROL: an ordinary top-level class, constructed by its bare name.
    return Inner().run()


def conditional_is_still_top_level() -> str:
    # CONTROL for the guard's edge case: a class inside `try:` or `if:` has NO enclosing
    # type and NO enclosing method, so type_top_level holds and it stays a module member.
    # Guarding on scope nesting generally, rather than on the enclosing MEMBER, would
    # have lost these — the risk flagged when the guard was proposed.
    return Conditional().run() + Guarded().run()


def owner_constructs_its_own_nested() -> str:
    # `Outer.Inner()` written INSIDE Outer, which is how the idiom usually appears.
    return Outer().make_nested()


def drive() -> str:
    _BAG["v"] = Inner()
    return " ".join([
        qualified(),
        deep(),
        bare_annotation(Inner()),
        bare_field(),
        meta_of_config(),
        meta_of_profile(),
        top_level_still_resolves(),
        owner_constructs_its_own_nested(),
        conditional_is_still_top_level(),
    ])
