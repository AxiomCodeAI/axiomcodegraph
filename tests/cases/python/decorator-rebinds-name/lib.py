import functools


def audited(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)
    return wrapper


@audited
def greet(name):
    return "hi " + name


def plain(name):
    return "hi " + name
