"""Java analogue: imports/ (module-function target)."""

from pkg.models import Account

_STORE = {}


def find_account(owner):
    """Returns an Account, but says so nowhere -- return typing must infer it."""
    existing = _STORE.get(owner)
    if existing is None:
        existing = Account(owner)
        _STORE[owner] = existing
    return existing


def make_ledger():
    from pkg.models import Ledger  # function-local import
    return Ledger()
