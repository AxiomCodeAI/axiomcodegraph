def deserialized():
    return "d"


def handled():
    return "h"


def other_handled():
    return "o"


class Field:
    def deserialize(self, value):
        return deserialized()


def default_handler():
    return handled()


def other_handler():
    return other_handled()


class Schema:
    def __init__(self):
        self.fields: list[Field] = [Field()]

    def getters(self):
        out = []
        for field_obj in self.fields:
            def getter(val, field_obj=field_obj):
                return field_obj.deserialize(val)
            out.append(getter)
        return out


def load(data):
    return [g(data) for g in Schema().getters()]


def notify(event, handler=default_handler):
    return handler()


def emit():
    return notify("e")
