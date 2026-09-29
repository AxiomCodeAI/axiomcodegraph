from app.cart import Ledger


def nightly(ledger: Ledger):
    return ledger.settle(1)


def replay(source):
    # the receiver comes from a parameter nobody typed
    return source.settle(2)


def rewind(source):
    return source.reopen(3)
