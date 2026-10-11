import mixkit._base as mb


def dotted_lookup(key):
    return key


class DottedStore(mb.Table):
    def __getitem__(self, key):
        return dotted_lookup(key)
