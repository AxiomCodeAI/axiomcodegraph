import mixkit.aliases as mt


def typed_lookup(key):
    return key


class TypedStore(mt.Table):
    def __getitem__(self, key):
        return typed_lookup(key)
