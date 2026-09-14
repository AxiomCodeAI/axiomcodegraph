"""@property (one name producing both a py_method and a py_field), a
full data descriptor implemented from scratch, and __slots__."""


class PositiveNumber:
    """A descriptor: __get__/__set__/__set_name__ define the protocol."""

    def __set_name__(self, owner, name):
        self.private_name = "_" + name

    def __get__(self, instance, owner=None):
        if instance is None:
            return self
        return getattr(instance, self.private_name, 0)

    def __set__(self, instance, value):
        if value < 0:
            raise ValueError("must be positive")
        setattr(instance, self.private_name, value)


class Temperature:
    __slots__ = ("_celsius", "_unit")

    def __init__(self, celsius):
        self._celsius = celsius
        self._unit = "C"

    @property
    def celsius(self):
        return self._celsius

    @celsius.setter
    def celsius(self, value):
        if value < -273.15:
            raise ValueError("below absolute zero")
        self._celsius = value

    @celsius.deleter
    def celsius(self):
        del self._celsius

    @property
    def fahrenheit(self):
        # a read-only property with no matching setter/deleter
        return self._celsius * 9 / 5 + 32


class Product:
    quantity = PositiveNumber()
    price = PositiveNumber()

    def __init__(self, quantity, price):
        self.quantity = quantity
        self.price = price

    @property
    def total(self):
        return self.quantity * self.price
