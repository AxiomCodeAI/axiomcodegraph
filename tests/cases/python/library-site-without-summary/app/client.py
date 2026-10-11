from netkit import Session


def record_lookup(key):
    return key


class AppSession(Session):
    def __init__(self):
        super().__init__(base_url="http://app")

    def __getitem__(self, key):
        return record_lookup(key)


class Pool:
    def __init__(self):
        self.size = 4

    def fetch(self, key):
        return key
