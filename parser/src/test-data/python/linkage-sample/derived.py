"""Cross-module and transitive base resolution.

Expected linkage is stated per site. Three MUST resolve; three MUST NOT, and the
must-nots matter as much — resolving them would mean guessing.
"""
from .models import Base, Child, Sibling

_Aliased = Base                       # bound by assignment, NOT by import


class Extended(Child):                # cross-module base -> models.Child      MUST resolve
    def describe(self):
        return super().describe()     # -> models.Child.describe               MUST resolve


class Deep(Extended):                 # same-module base -> Extended           MUST resolve
    def tagged(self, *items, **meta):
        # Extended does not declare tagged; models.Child does.
        return super().tagged(*items, **meta)   # transitive MRO hop            MUST resolve


class Mixed(Child, Sibling):          # both bases declare describe
    def describe(self):
        # Not ambiguous: C3 gives Mixed -> Child -> Base -> Sibling -> object,
        # so this is Child.describe. Verified against CPython __mro__.
        return super().describe()     # -> models.Child.describe               MUST resolve


class SampleError(Exception):         # builtin base
    def __init__(self, msg):
        super().__init__(msg)         # external base              MUST STAY UNRESOLVED


class ViaAlias(_Aliased):             # base reached through an assignment alias
    pass                              # alias, not import          MUST STAY UNRESOLVED
