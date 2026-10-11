import typing as t
from typing import Optional, Union


class Foo:
    def go(self):
        return 1


class Bar:
    def go(self):
        return 2


def p_plain(x: Foo):
    return x.go()


def p_optional(x: Optional[Foo]):
    return x.go()


def p_t_optional(x: t.Optional[Foo]):
    return x.go()


def p_pipe(x: Foo | None):
    return x.go()


def p_union(x: Union[Foo, Bar]):
    return x.go()


def l_optional(y):
    z: Optional[Foo] = y
    return z.go()


def l_pipe(y):
    z: Foo | Bar | None = y
    return z.go()


def p_pipe3(x: Foo | Bar | None):
    return x.go()
