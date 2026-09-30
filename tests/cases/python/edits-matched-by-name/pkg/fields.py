class Field:
    default = None
    required = False

    def get_attribute(self, instance):
        return getattr(instance, self.name)

    def run(self):
        return self.default


class HStoreField(Field):
    child = None

    def run(self):
        return {}


class CharField(Field):
    max_length = None

    def run(self):
        return ''
