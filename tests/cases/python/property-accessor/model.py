class Doc:
    def __init__(self, size):
        self._size = size

    @property
    def size(self):
        return self._size

def show(d: Doc):
    return d.size
