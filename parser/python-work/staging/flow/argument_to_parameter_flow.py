"""Java analogue: methods/ + method-parameters.

THE primary receiver-typing mechanism for Python. 68.2% of parameters in the
measured corpus carry no annotation, so a parameter's type is knowable only from
what callers actually pass at that position -- or under that keyword.

Each callee below has an unannotated parameter used as a receiver. Each caller
passes a concretely-typed argument. The link is the fact under test.
"""

from pkg.models import Account, Ledger


# ---- callees: unannotated parameters used as receivers --------------------

def positional_callee(account):
    # `account` is untyped here; only the call sites below say what it is
    return account.balance()


def two_positional_callee(first, second):
    return first.balance() + second.balance()


def keyword_callee(*, account, ledger):
    # KEYWORD-ONLY: these cannot be linked positionally. 12,000 keyword args in
    # the corpus would be lost to a positional-only linker.
    ledger.record(account)
    return ledger.total()


def defaulted_callee(account, factor=2):
    return account.balance() * factor


def mixed_callee(ledger, account, note=None):
    ledger.record(account)
    return note


# ---- callers: supply concretely-typed arguments ---------------------------

def call_positional(owner):
    made = Account(owner)
    return positional_callee(made)


def call_positional_twice(owner_a, owner_b):
    return two_positional_callee(Account(owner_a), Account(owner_b))


def call_by_keyword(owner):
    # arguments arrive OUT OF ORDER and by name -- position tells you nothing
    return keyword_callee(ledger=Ledger(), account=Account(owner))


def call_with_default_overridden(owner):
    return defaulted_callee(Account(owner), factor=3)


def call_with_default_taken(owner):
    return defaulted_callee(Account(owner))


def call_mixed_positional_and_keyword(owner):
    # first arg positional, second positional, third by keyword
    return mixed_callee(Ledger(), Account(owner), note="opening")


def call_transitive(owner):
    # two hops: this caller's argument flows into positional_callee's parameter
    # via an intermediate function that just forwards it
    return forwarding_callee(Account(owner))


def forwarding_callee(account):
    # pure delegation: whatever flows in here flows straight through
    return positional_callee(account)


def call_same_param_two_types(owner, ledger):
    # the SAME parameter receives two different concrete types across call
    # sites -- the union case. Sound answer is both, not one.
    positional_callee(Account(owner))
    positional_callee(ledger)
