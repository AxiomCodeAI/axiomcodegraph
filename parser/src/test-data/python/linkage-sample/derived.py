"""Base-resolution axes. All bases internal."""
from .models import Base, Child, Sibling

_Aliased = Base                       # assignment alias, NOT an import


class Extended(Child):                # cross-module NAME base -> models.Child   MUST resolve
    def describe(self):
        return super().describe()     # -> models.Child.describe                 MUST resolve


class Deep(Extended):                 # same-module base -> Extended             MUST resolve
    def tagged(self, *items, **meta):
        # Extended does not declare tagged; models.Child does. Transitive MRO hop.
        return super().tagged(*items, **meta)                                   # MUST resolve


class Mixed(Child, Sibling):          # C3: Mixed -> Child -> Base -> Sibling -> object
    def describe(self):
        return super().describe()     # -> models.Child.describe                 MUST resolve


class ViaAlias(_Aliased):             # base bound by assignment, not import
    def describe(self):
        return super().describe()     # alias base, not an import   MUST STAY UNRESOLVED
        # This is the correct answer, not a gap: _Aliased is bound by assignment,
        # so the base is only knowable by evaluating module-level code.
