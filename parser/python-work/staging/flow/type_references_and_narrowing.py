"""Java analogue: type-references/.

Where a type NAME appears in Python: annotations, base classes, isinstance /
issubclass, cast, except clauses, raise. Plus the narrowing forms, which are the
main lever against a 24.6-candidate fan-out.

isinstance appears 2,123 times in the measured corpus; cast 359.
"""

from typing import Optional, Union, List, Dict, Callable, Any, cast

from pkg.models import Account, Ledger


def annotated_parameters(account: Account, ledger: Ledger, count: int) -> int:
    # declared types: free precision, but only 31.8% of real params have them
    ledger.record(account)
    return ledger.total() + count


def optional_annotation(account: Optional[Account]) -> int:
    # Optional[X] is the single most common subscript in the corpus (3,517)
    if account is None:
        return 0
    return account.balance()


def union_annotation(value: Union[Account, Ledger]) -> str:
    return repr(value)


def nested_subscript(rows: Dict[str, List[Account]]) -> int:
    total = 0
    for accounts in rows.values():
        for account in accounts:
            total += account.balance()
    return total


def callable_annotation(fn: Callable[[int], int], seed: int) -> int:
    return fn(seed)


def string_forward_reference(other: "Account") -> "Ledger":
    # a forward reference written as a string literal (573 in the corpus)
    ledger = Ledger()
    ledger.record(other)
    return ledger


def annotated_local_and_attribute() -> None:
    holder: Account = Account("x")
    later: Ledger
    later = Ledger()
    later.record(holder)


def isinstance_narrowing(value):
    # the guard narrows an untyped receiver from N candidates to exactly one
    if isinstance(value, Account):
        return value.balance()
    if isinstance(value, Ledger):
        return value.total()
    return None


def isinstance_tuple_narrowing(value):
    if isinstance(value, (Account, Ledger)):
        return repr(value)
    return ""


def negative_isinstance_narrowing(value):
    # narrowing on the ELSE side
    if not isinstance(value, Account):
        return None
    return value.balance()


def issubclass_check(klass):
    if issubclass(klass, Account):
        return klass("owner")
    return None


def cast_narrowing(value):
    # an explicit assertion -- syntactic, and free
    account = cast(Account, value)
    return account.balance()


def any_annotation(value: Any):
    # Any is an explicit surrender; the engine should not pretend otherwise
    return value.whatever()


def exception_types(path):
    try:
        return open(path).read()
    except FileNotFoundError as missing:
        raise ValueError("missing") from missing
    except (OSError, RuntimeError):
        raise
    finally:
        pass


class AnnotatedFields:
    # class-body annotations, with and without values
    name: str
    count: int = 0
    ledger: Ledger = Ledger()

    def __init__(self, name: str) -> None:
        self.name = name
        self.primary: Account = Account(name)
