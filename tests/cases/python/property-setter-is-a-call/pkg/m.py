class Box:
    def __init__(self):
        self._v = 0

    @property
    def value(self):
        return self._v

    @value.setter
    def value(self, v):
        self._v = check(v)

    @value.deleter
    def value(self):
        self._v = None


def check(v):
    return v


def fill(b: Box):
    b.value = 3


def clear(b: Box):
    del b.value


def read(b: Box):
    return b.value
