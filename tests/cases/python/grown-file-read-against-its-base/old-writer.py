class Writer:
    codec = None

    def __init__(self, store, codec):
        self.store = store
        self.codec = codec

    def write(self, e):
        self.store.append(e)
        body = self.codec.encode(e)
        self.store.save((e.id, body))

    @staticmethod
    def priority(e):
        return "normal"
