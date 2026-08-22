"""A4 audit fixture: does a nested annotation decompose into linked
py_type_reference rows, and is the field the OWNER of its own type reference?

Every annotation below is a different nesting depth or context.
"""
from typing import ClassVar, Dict, List, Optional, Union, Callable, Tuple
import collections.abc


class Account:
    TABLE: ClassVar[str] = "accounts"                       # depth 2
    INDEX: ClassVar[Dict[str, List[int]]] = {}              # depth 4
    plain: int = 0                                          # depth 1
    dotted: collections.abc.Mapping = {}                    # dotted, depth 1
    optional: Optional[str] = None                          # Optional
    pep604: int | None = None                               # PEP 604 union
    forward: "Account" = None                               # string forward ref
    call: Callable[[int, str], bool] = None                 # nested list arg
    pair: Tuple[int, ...] = ()                              # ellipsis in a tuple

    def method(self, arg: Dict[str, List[Optional[int]]]) -> Union[str, None]:
        local: List[int] = []
        return None


def free_function(x: Optional[Dict[str, int]]) -> "List[Account]":
    return []
