# The decorated functions live here; every call through their names that matters is
# written in another module (main.py, pkg/sibling.py). A call in this module is the
# control: the same-module shape already reached the wrapper before #1248.
import functools

import unstaged_registry


def plain_deco(fn):
    def wrapper(*a):
        return fn(*a)
    return wrapper


def wraps_deco(fn):
    @functools.wraps(fn)
    def wrapper(*a):
        return fn(*a)
    return wrapper


def passthrough(fn):
    return fn


@plain_deco
def f_plain(x):
    return x


@wraps_deco
def f_wraps(x):
    return x


@passthrough
def f_passthrough(x):
    return x


@unstaged_registry.register
def f_opaque(x):
    return x


def undecorated(x):
    return x


def local_use():
    f_plain(0)
    f_wraps(0)
