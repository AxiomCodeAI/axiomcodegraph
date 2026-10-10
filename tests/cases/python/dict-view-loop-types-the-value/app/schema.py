def serialize_field():
    return "s"


def deserialize_field():
    return "d"


def describe_field():
    return "x"


def key_upper():
    return "K"


class Field:
    def serialize(self, value):
        return serialize_field()

    def deserialize(self, value):
        return deserialize_field()

    def describe(self):
        return describe_field()


class Name:
    def upper(self):
        return key_upper()


class Schema:
    def __init__(self):
        self.dump_fields: dict[str, Field] = {}
        self.load_fields: dict[str, Field] = {}
        self.names: dict[Name, int] = {}

    def dump(self, obj):
        out = {}
        for attr_name, field_obj in self.dump_fields.items():
            out[attr_name] = field_obj.serialize(obj)
        return out

    def load(self, data):
        return [f.deserialize(data) for f in self.load_fields.values()]

    def keys_only(self):
        return [k.upper() for k in self.names.keys()]

    def counts(self):
        total = 0
        for name, count in self.names.items():
            total += count
        return total
