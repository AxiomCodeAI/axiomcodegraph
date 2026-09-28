class Ledger:
    def record(self, amount):
        return amount


def charge(ledger, amount):
    return ledger.record(amount)


def checkout(amount):
    return charge(Ledger(), amount)
