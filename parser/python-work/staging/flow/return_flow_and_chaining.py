"""Java analogue: methods/ (return types) + expressions/ (chained calls).

Path (4): a receiver that is itself a call result. 7.3% of attribute-call
receivers. Resolving these needs the callee's return type, which -- with only
47% of returns annotated -- usually means inferring it from the return
statements.
"""

from pkg.models import Account, Ledger


def returns_new_directly(owner):
    """Single return of a constructor call: the concrete type is pinned."""
    return Account(owner)


def returns_annotated(owner) -> Account:
    """Annotated return: free precision when it is present."""
    return Account(owner)


def returns_via_delegation(owner):
    """Delegates to a function whose return IS pinned -- transitive."""
    return returns_new_directly(owner)


def returns_two_types(owner, flag):
    """Two return statements, two types: the union, not a guess."""
    if flag:
        return Account(owner)
    return Ledger()


def returns_early_and_late(owner, flag):
    if not flag:
        return None
    return Account(owner)


def returns_self_for_chaining(owner):
    return Account(owner).deposit(10)


class Service:
    def __init__(self):
        self.ledger = Ledger()

    def get_ledger(self):
        """Getter-of-field: the return type is the field's type."""
        return self.ledger

    def make_account(self, owner):
        return Account(owner)

    def chained_through_self(self, owner):
        # self.make_account(...) -> Account, then .deposit -> Account, then
        # .balance -> int. A three-link chain rooted at a self call.
        return self.make_account(owner).deposit(5).balance()


def chain_depth_two(owner):
    return returns_new_directly(owner).balance()


def chain_depth_three(owner):
    return returns_new_directly(owner).deposit(10).balance()


def chain_depth_four(owner):
    return returns_new_directly(owner).deposit(10).withdraw(3).balance()


def chain_through_getter():
    service = Service()
    return service.get_ledger().total()


def chain_off_a_constructor(owner):
    # no intermediate local at all
    return Account(owner).deposit(1).withdraw(1).balance()


def chain_off_a_module_function(owner):
    from pkg.repository import find_account
    return find_account(owner).deposit(2).balance()
