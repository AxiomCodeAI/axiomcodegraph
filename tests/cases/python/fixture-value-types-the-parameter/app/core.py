class Session:
    def __init__(self, name):
        self.name = name

    def begin(self):
        return Transaction(self)

    def close(self):
        return None


class Transaction:
    def __init__(self, session):
        self.session = session

    def commit(self):
        return validate(self.session.name)


def validate(name):
    return bool(name)


class Ledger:
    def post(self, amount):
        return amount
