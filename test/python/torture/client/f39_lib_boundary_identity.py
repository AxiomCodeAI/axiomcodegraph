"""FAMILY 39 — a boundary target names the LIBRARY TYPE, not the client's variable
(issue #311).

Where a library is staged and the member does not resolve, `lib-linking.dl` labels the
target from `call_dotted` — the call AS WRITTEN. For a module-qualified call that reads as
a library path and is fine. For a call on a local or a parameter it is the CLIENT's own
variable name:

    d = Deferred(); d.ping()          ->  lib:d.ping
    def go(x: Deferred): x.ping()     ->  lib:x.ping

Two clients with different local names then produce different targets for the same library
member, and one client using `d` in two functions produces the same target for two
different ones — which SCORING.md §8 rules out in as many words. With no library staged
the same site reads `external:Deferred.ping`, so staging, which is strictly more
information, made the target LESS identifiable.

`Deferred` supplies its members through `__getattr__`, which is what makes this reachable
in a fixture: the TYPE is known to the engine and the MEMBER is declared nowhere, which is
exactly the state a partially staged library leaves behind — #311's own example is a member
inherited from a base the staged library does not carry.

`resolves_normally` is the control: a member the library DOES declare must still reach its
concrete target rather than any label at all.
"""
from tlib import Deferred, Square


def on_a_local() -> str:
    # EXPECT: miss — and the marker is about the ORACLE, not about this rule. The engine
    # emits a NAMED BOUNDARY here, which is the right answer: the member is declared
    # nowhere it can see. Tier 4 observes what __getattr__ actually returned, so a label
    # and a target can never agree, and scoring these as links would drag headline recall
    # for a site that is answered correctly. What this family asserts is the LABEL, and
    # expected/torture.edges pins it exactly.
    d = Deferred()
    return d.ping()


def on_a_parameter(x: Deferred) -> str:
    # EXPECT: miss — same reason as above, through a parameter rather than a local.
    return x.pong()


def resolves_normally() -> str:
    # CONTROL: a real declared member of a staged library type.
    return Square().name()


def drive() -> str:
    return " ".join([on_a_local(), on_a_parameter(Deferred()), resolves_normally()])
