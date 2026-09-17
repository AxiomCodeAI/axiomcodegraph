"""Real source for `pkg`. `build/lib/pkg/core.py` is a byte-for-byte copy of
this file -- exactly what `python -m build` leaves behind after a build run in
place (#564)."""


def greet(name):
    return f"hello {name}"


class Greeter:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return greet(self.name)
