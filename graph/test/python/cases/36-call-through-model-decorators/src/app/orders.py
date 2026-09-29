"""36 -- decorators that validate or mark, then call the decorated def (#1534).

INTENT: pydantic's `@validate_call` validates the arguments and calls the
function; `@computed_field` marks a property for serialization and a read still
runs the getter. Both call through, like `@functools.cache`, so the name at the
call site still reaches the `def`. As unknown decorators they were assumed to
replace their target and the def left lookup: the caller fell to by-name and the
computed field had no reader.

Controls:
  apply_tax    undecorated: resolved before and after
  net_total    plain @property: resolved before and after
  replaced     an unknown decorator still replaces its target, so its caller
               stays unresolved
"""
from pydantic import BaseModel, computed_field, validate_call

import pydantic


def audit(fn):
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)

    return wrapper


@validate_call
def apply_discount(price: float) -> float:
    return round(price * 0.9, 2)


@pydantic.validate_call(validate_return=True)
def apply_coupon(price: float) -> float:
    return price - 1


def apply_tax(price: float) -> float:
    return round(price * 1.2, 2)


@audit
def replaced(price: float) -> float:
    return price


class Order(BaseModel):
    total: float

    @computed_field
    @property
    def grand_total(self) -> float:
        return self.total * 1.2

    @computed_field
    def tax_due(self) -> float:
        return self.total * 0.2

    @property
    def net_total(self) -> float:
        return self.total
