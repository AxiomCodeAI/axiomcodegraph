def describe_type(t):
    return t.__name__


def count_items():
    return 3


def plain_text():
    return "plain"


class InstanceOf:
    def __init__(self, type):
        self.type = type

    def __repr__(self):
        return f"<instance_of {describe_type(self.type)}>"


class Bag:
    def __len__(self):
        return count_items()


class Plain:
    def __repr__(self):
        return plain_text()


class Shown:
    def __str__(self):
        return "shown"

    def __repr__(self):
        return plain_text()


def instance_of(type):
    return InstanceOf(type)
