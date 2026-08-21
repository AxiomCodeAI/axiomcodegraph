"""Java analogue: methods/ (varargs).

Where argument->parameter flow is PROVABLY unsound. 2.8% of functions in the
corpus take both *args and **kwargs; 11.9% take **kwargs. Positional linking
cannot see through a splat, so the engine must report imprecision here rather
than invent a link.

These fixtures exist so the parser marks the imprecision, not so it resolves it.
"""

from pkg.models import Account, Ledger


def concrete_target(account, ledger, note=None):
    ledger.record(account)
    return note


def star_only_passthrough(*args):
    # positional identity is destroyed: arg 0 here is arg 0 of the caller's
    # tuple, not of concrete_target
    return concrete_target(*args)


def kwargs_only_passthrough(**kwargs):
    return concrete_target(**kwargs)


def full_passthrough(*args, **kwargs):
    # the classic decorator/wrapper shape -- no positional link survives
    return concrete_target(*args, **kwargs)


def partial_splat(account, *rest):
    # arg 0 IS linkable; the remainder is not
    return concrete_target(account, *rest)


def splat_a_literal_tuple(account, ledger):
    # parenthesized_list_splat: the tuple is known, so this one IS recoverable
    return concrete_target(*(account, ledger))


def splat_a_genexp(accounts):
    return sum(*(a.balance() for a in accounts))


def call_through_passthrough(owner):
    full_passthrough(Account(owner), Ledger(), note="via splat")
    star_only_passthrough(Account(owner), Ledger())
    kwargs_only_passthrough(account=Account(owner), ledger=Ledger())
    partial_splat(Account(owner), Ledger())
    splat_a_literal_tuple(Account(owner), Ledger())
