"""Dataclasses (plain, frozen, and with field(default_factory=...) to avoid
the mutable-default trap), a deliberately unsafe mutable default argument
for contrast, and private name mangling (`__x` inside a class body becomes
`_ClassName__x`)."""

from dataclasses import dataclass, field


@dataclass
class Point:
    x: int
    y: int = 0


@dataclass(frozen=True)
class FrozenPoint:
    x: int
    y: int


@dataclass
class Basket:
    # safe: default_factory avoids sharing one list across instances
    items: list = field(default_factory=list)
    owner: str = "nobody"


def append_unsafe(item, bucket=[]):
    # classic mutable-default hazard: `bucket` is evaluated once, at
    # function-definition time, and shared across every call that omits it
    bucket.append(item)
    return bucket


def append_safe(item, bucket=None):
    if bucket is None:
        bucket = []
    bucket.append(item)
    return bucket


class Account:
    def __init__(self, balance):
        # name-mangled to `_Account__balance` inside this class body
        self.__balance = balance
        # single leading underscore is *not* mangled — plain "protected" convention
        self._history = []

    def __repr__(self):
        # reading the mangled name from the same class: resolves to
        # `_Account__balance` again, same identity as the write in __init__
        return f"Account(balance={self.__balance!r})"

    def _record(self, note):
        self._history.append(note)


class SavingsAccount(Account):
    def audit(self):
        # a *different* class referring to `__balance` mangles to
        # `_SavingsAccount__balance`, which is NOT the same attribute as
        # `Account.__balance` — this is deliberately the divergence case
        try:
            return self.__balance
        except AttributeError:
            return None
