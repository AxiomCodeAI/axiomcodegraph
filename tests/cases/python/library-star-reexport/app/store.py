from mixkit.abc import Table, Plain


def lookup_key(key):
    return key.upper()


def store_key(key):
    return key.lower()


def plain_lookup(key):
    return key


class Store(Table):
    def __getitem__(self, key):
        return lookup_key(key)

    def __setitem__(self, key, value):
        store_key(key)


class Flat(Plain):
    def __getitem__(self, key):
        return plain_lookup(key)
