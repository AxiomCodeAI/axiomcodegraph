_TABLE = {}


def normalise(name):
    return name.strip().lower()


def register(name):
    def deco(fn):
        _TABLE[normalise(name)] = fn
        return fn
    return deco


def lookup(name):
    return _TABLE[normalise(name)]


def describe(name):
    return f"handler {normalise(name)}"


@register("Default")
def default_handler():
    return "default"
