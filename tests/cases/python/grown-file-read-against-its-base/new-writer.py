class Writer:

    def __init__(self, store):
        self.store = store

    def write(self, e):
        self.store.append(e)

    @staticmethod
    def priority(e):
        return "normal"
