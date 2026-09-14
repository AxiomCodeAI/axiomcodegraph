"""02 -- methods. Instance, classmethod, staticmethod, property getter.

INTENT: the four descriptor forms, which `inspect.getattr_static` keeps distinct
and bare `getattr` collapses. Measured: `getattr` returns a plain function for a
staticmethod, a bound method for a classmethod, and EXECUTES a property getter.
Each form's underlying function is reached differently (`.__func__`, `.fget`),
and all four must still join to a source line.
"""


class Widget:
    def __init__(self, size):
        self.size = size

    def area(self):
        # Instance method through `self`.
        return self.size * self.scale()

    def scale(self):
        return 2

    @classmethod
    def square(cls, side):
        # `cls` is the receiver; construction goes through cls.__mro__.
        return cls(side)

    @staticmethod
    def describe():
        # No receiver at all -- an ordinary function that happens to live in a
        # class body.
        return "widget"

    @property
    def doubled(self):
        # A property getter is only ever reached through the descriptor
        # protocol; there is no call site spelling `doubled()`.
        return self.size * 2


def main():
    w = Widget(3)
    print(w.area())
    print(Widget.square(4).area())
    print(Widget.describe())
    print(w.doubled)


if __name__ == "__main__":
    main()
