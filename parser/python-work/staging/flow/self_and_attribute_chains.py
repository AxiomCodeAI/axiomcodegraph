"""Java analogue: fields/ + expressions/.

Paths (2) and (3): a `self` receiver (19.6% of attribute calls) and an attribute
chain (18.8%, 99.98% within depth 3).

`self` is the biggest free precision win available: it is exactly the enclosing
class or a subclass, so no CHA fan-out is needed. Attribute chains need the
field's type first, then the method lookup on it.
"""

from pkg.models import Account, Ledger


class Repository:
    def __init__(self):
        self.ledger = Ledger()
        self.cache = {}

    def store(self, account):
        self.ledger.record(account)
        self.cache[account.owner] = account
        return self

    def total(self):
        # depth-2 chain rooted at self: self.ledger -> Ledger, .total() -> int
        return self.ledger.total()


class Service:
    """self.* attributes written across several methods, not only __init__.

    Only 67% of self-attribute writes in the corpus are in __init__, so an
    attribute is a SET of writes, not a declaration.
    """

    def __init__(self, owner):
        self.repo = Repository()
        self.owner = owner
        self.primary = Account(owner)
        self.audit = None

    def open_secondary(self, other_owner):
        # a second attribute, first written OUTSIDE __init__
        self.secondary = Account(other_owner)
        return self.secondary

    def reset(self):
        # the same attribute written again, in a different method
        self.primary = Account(self.owner)
        self.audit = []

    def self_method_call(self):
        # path (2): plain self receiver
        return self.compute()

    def compute(self):
        return self.primary.balance()

    def depth_two_chain(self):
        # self.primary -> Account, .balance() -> int
        return self.primary.balance()

    def depth_three_chain(self):
        # self.repo -> Repository, .ledger -> Ledger, .total() -> int
        return self.repo.ledger.total()

    def chain_then_call(self, other_owner):
        # self.repo -> Repository, .store(...) -> Repository, .total() -> int
        return self.repo.store(Account(other_owner)).total()

    def attribute_written_then_read(self, other_owner):
        # write in one method, read in another: the flow conduit case
        self.open_secondary(other_owner)
        return self.secondary.balance()

    def augmented_attribute(self, amount):
        self.counter = 0
        self.counter += amount
        return self.counter

    def foreign_object_write(self, account):
        # writing an attribute on someone ELSE's object. There is no declaration
        # site and we cannot know account's class here, so this must NOT become
        # a field of Service.
        account.tag = "seen"
        return account


class Derived(Service):
    def uses_inherited_attribute(self):
        # self.primary is declared in the BASE class -- resolution must walk
        # the MRO to find it
        return self.primary.balance()

    def calls_inherited_method(self):
        return self.compute()

    def super_call(self, owner):
        # super() is an MRO-ordered lookup starting AFTER Derived, not a
        # virtual dispatch
        return super().compute()


def chain_from_a_local(owner):
    service = Service(owner)
    return service.repo.ledger.total()


def chain_from_a_parameter(service):
    # unannotated parameter, then a depth-3 chain off it
    return service.repo.ledger.total()
