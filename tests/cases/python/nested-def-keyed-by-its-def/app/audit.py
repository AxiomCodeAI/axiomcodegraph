from functools import wraps


def record(name):
    return name


def audited(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        record(f.__name__)
        return f(*args, **kwargs)

    return wrapper
