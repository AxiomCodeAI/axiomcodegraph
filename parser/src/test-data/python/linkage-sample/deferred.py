"""Known-deferred receiver shapes, isolated so they don't muddy the must-resolve count.

ATTRIBUTE and CALL_RESULT receivers need attribute/return typing, which is deferred.
The three attribute/call-result sites in use() are expected UNRESOLVED. The
constructor calls in __init__ are ordinary NAME sites and must resolve.
"""
from .models import Base, Child, Sibling


class Holder:
    def __init__(self):
        self.base = Base("b")
        self.child = Child("c")

    def use(self):
        a = self.base.describe()      # ATTRIBUTE   -> needs attribute typing
        b = self.child.merge(1, k=2)  # ATTRIBUTE   -> needs attribute typing
        c = Sibling().describe()      # CALL_RESULT -> needs return typing
        return [a, b, c]
