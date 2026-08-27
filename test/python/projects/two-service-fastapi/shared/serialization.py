"""Generic serializers reached through a decorator-populated registry.

`@serializer("item")` is a PARAMETERISED decorator applied to a CLASS: two calls, and the
applied callable is the factory's return value. `serialize` then looks the class up by a
literal key and CONSTRUCTS it, so the chain is
    serialize -> SERIALIZERS[name] -> ItemSerializer() -> .to_dict
and every hop is a different mechanism.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, Generic, Iterable, List, Type, TypeVar

T = TypeVar("T")

SERIALIZERS: Dict[str, Type["Serializer"]] = {}


def serializer(name: str):
    def register(cls):
        SERIALIZERS[name] = cls
        return cls

    return register


class Serializer(Generic[T], ABC):
    @abstractmethod
    def to_dict(self, obj: T) -> Dict[str, Any]:
        ...

    def to_dicts(self, objs: Iterable[T]) -> List[Dict[str, Any]]:
        return [self.to_dict(obj) for obj in objs]

    @staticmethod
    def envelope(kind: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return {"kind": kind, "body": body}


def serialize(name: str, obj: Any) -> Dict[str, Any]:
    cls = SERIALIZERS[name]
    return cls().to_dict(obj)
