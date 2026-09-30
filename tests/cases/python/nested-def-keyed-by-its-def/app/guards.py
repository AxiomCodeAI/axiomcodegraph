from functools import wraps


def check():
    return True


def guarded(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        check()
        return f(*args, **kwargs)

    return wrapper
