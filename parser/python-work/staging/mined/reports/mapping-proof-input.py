GLOBAL = 1

def outer(a, b=2, *args, c, **kw):
    total = a + b

    def inner():
        nonlocal total
        total += 1
        return total

    squares = [x * x for x in range(3)]
    pick = lambda k: k + total
    return inner, squares, pick


class Model:
    field: int = 0

    def method(self):
        global GLOBAL
        GLOBAL = 2
        return self.field
