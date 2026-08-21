"""Java analogue: local-variables/.

Path (1) again, but through LOCALS rather than imports. Locals are 36.8% of
bare-name receivers -- the second-largest bucket. Whether a local is resolvable
depends entirely on the shape of what is assigned into it, so this fixture
walks the shapes in order of how much they give away.
"""

from pkg.models import Account, Ledger
from pkg.repository import find_account


def monomorphic_from_constructor(owner):
    # assigned exactly once, from a constructor call: the held type is known
    account = Account(owner)
    return account.balance()


def reassigned_same_type(owner_a, owner_b):
    # two assignments, both the same concrete type: still monomorphic
    account = Account(owner_a)
    account = Account(owner_b)
    return account.balance()


def reassigned_different_types(owner):
    # two assignments, two DIFFERENT types: the sound answer is the union.
    # Picking one would be wrong; picking neither loses a real edge.
    holder = Account(owner)
    holder = Ledger()
    return holder


def conditional_reassignment(owner, flag):
    # branch-dependent type -- both arms are reachable
    value = Account(owner)
    if flag:
        value = Ledger()
    return value


def augmented_assignment(owner):
    total = Account(owner).balance()
    total += 10
    total -= 3
    return total


def from_literal():
    # literal inference: certain, no name resolution needed
    count = 3
    label = "ledger"
    ratio = 1.5
    flags = [1, 2, 3]
    mapping = {"a": 1}
    unique = {1, 2}
    pair = (1, 2)
    return count.bit_length(), label.upper(), ratio.is_integer(), flags.append, \
        mapping.keys(), unique.add, pair.count


def from_call_result(owner):
    # the local's type is the CALLEE's return type -- needs return flow
    account = find_account(owner)
    return account.balance()


def from_another_local(owner):
    first = Account(owner)
    second = first
    return second.balance()


def from_attribute(ledger):
    entries = ledger.entries
    return entries.append


def loop_target(accounts):
    # a for-target's type is the ITERABLE's element type
    running = 0
    for account in accounts:
        running = running + account.balance()
    return running


def with_target(path):
    with open(path) as handle:
        return handle.read()


def tuple_unpacked(pair):
    left, right = pair
    return left.balance(), right.total()


def star_unpacked(items):
    head, *tail = items
    return head.balance(), tail


def walrus_target(owner):
    if (account := Account(owner)) is not None:
        return account.balance()
    return 0


def shadowing_a_parameter(account):
    # the parameter is shadowed by a local of a different type mid-body
    account = Ledger()
    return account.total()
