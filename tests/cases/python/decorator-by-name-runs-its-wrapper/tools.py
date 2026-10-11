"""Two decorators the project declares: one hands back a wrapper, one registers and hands back the function."""
REGISTRY = {}


def timed(fn):
    def wrapper(*args):
        tick()
        return fn(*args)
    return wrapper


def tick():
    return 1


def registered(name):
    def register(fn):
        REGISTRY[name] = fn
        remember(name)
        return fn
    return register


def remember(name):
    return name
