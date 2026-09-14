"""Stacked decorators, parameterized (factory) decorators, and the
argument-position shift caused by @staticmethod (no shift) vs an instance
method (self at 0) vs @classmethod (cls at 0)."""

import functools


def log_calls(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        print(f"calling {func.__name__}")
        return func(*args, **kwargs)

    return wrapper


def retry(times):
    """Parameterized decorator: a factory that returns the real decorator."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for _ in range(times):
                try:
                    return func(*args, **kwargs)
                except Exception as exc:
                    last_error = exc
            raise last_error

        return wrapper

    return decorator


def validate_args(*, min_args=0):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            if len(args) < min_args:
                raise TypeError("not enough arguments")
            return func(*args, **kwargs)

        return wrapper

    return decorator


class Service:
    @log_calls
    @retry(times=3)
    @validate_args(min_args=1)
    def fetch(self, resource_id):
        # instance method: `self` occupies position 0, `resource_id` is 1
        return resource_id

    @staticmethod
    @log_calls
    def parse(payload):
        # staticmethod: no implicit receiver, `payload` is position 0
        return payload

    @classmethod
    @log_calls
    def create(cls, name):
        # classmethod: `cls` occupies position 0, `name` is 1 — same shift
        # shape as an instance method but bound to the class, not self
        return cls(name)

    def __init__(self, name=""):
        self.name = name
