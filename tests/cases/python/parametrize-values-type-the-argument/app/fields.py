def string_done():
    return "s"


def integer_done():
    return "i"


def box_done():
    return "b"


def plain_done():
    return "p"


def never_done():
    return "n"


class String:
    def deserialize(self, value):
        return string_done()


class Integer:
    def deserialize(self, value):
        return integer_done()


class Box:
    def open(self):
        return box_done()


class Converter:
    def __init__(self, strict=False):
        self.strict = strict

    def structure(self, value):
        return plain_done()


class Unused:
    def structure(self, value):
        return never_done()
