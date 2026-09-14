"""Diamond inheritance with C3 linearization, super() in a multi-base
class, a metaclass, and self.x written from three different methods (the
schema's finding that only ~67% of self.x writes happen in __init__)."""


class Base:
    def greet(self):
        return "Base"


class Left(Base):
    def greet(self):
        return "Left -> " + super().greet()


class Right(Base):
    def greet(self):
        return "Right -> " + super().greet()


class Diamond(Left, Right):
    # C3 linearization: Diamond, Left, Right, Base, object.
    # super().greet() from Diamond must land on Left, not Base directly.
    def greet(self):
        return "Diamond -> " + super().greet()


class LoggingMeta(type):
    """A metaclass that tags every class it creates."""

    def __new__(mcs, name, bases, namespace):
        namespace["created_by_metaclass"] = True
        return super().__new__(mcs, name, bases, namespace)

    def __call__(cls, *args, **kwargs):
        instance = super().__call__(*args, **kwargs)
        instance.instantiated_via_meta = True
        return instance


class Widget(metaclass=LoggingMeta):
    def __init__(self, label):
        self.label = label


class Account:
    def __init__(self, owner):
        # write #1: in __init__
        self.owner = owner
        self.balance = 0

    def deposit(self, amount):
        # write #2: augmented assignment from a non-__init__ method
        self.balance += amount
        return self.balance

    def rename(self, new_owner):
        # write #3: plain assignment from yet another non-__init__ method
        self.owner = new_owner
        return self.owner

    def close(self):
        # a fourth write site for `balance`, still not __init__
        self.balance = 0
        self.closed = True
        return self.closed
