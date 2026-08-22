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
        return super().describe()     # alias base, not an import   MUST resolve
        # Previously asserted MUST STAY UNRESOLVED, on the reasoning that a base
        # bound by assignment is knowable only by evaluating module-level code.
        # That reasoning was wrong for this shape: `_Aliased = Base` binds a name
        # to a class and never rebinds it, so resolving it needs no evaluation,
        # only the binding. An independent resolver answers models.Base here,
        # which is what settled it.
