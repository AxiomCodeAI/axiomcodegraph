"""Java analogue: type-registry/ (declaration site in another module)."""


class Account:
    """Target of cross-module resolution from several other fixtures."""

    def __init__(self, owner):
        self.owner = owner
        self._balance = 0

    def deposit(self, amount):
        self._balance = self._balance + amount
        return self

    def withdraw(self, amount):
        self._balance = self._balance - amount
        return self

    def balance(self):
        return self._balance


class Ledger:
    def __init__(self):
        self.entries = []

    def record(self, account):
        # `account` is an unannotated parameter: its type is only knowable from
        # what callers pass, which is argument->parameter flow
        self.entries.append(account)
        return self

    def total(self):
        running = 0
        for entry in self.entries:
            running = running + entry.balance()
        return running
