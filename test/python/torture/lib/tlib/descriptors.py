"""FAMILY: classmethod / staticmethod / property.
`Factory.from_config(...)` is the AutoModel.from_config shape -- 75 misses on
transformers, a classmethod reached through the CLASS OBJECT."""
from typing import List


class Config:
    def __init__(self, tag: str = "cfg") -> None:
        self._tag = tag

    @property
    def tag(self) -> str:
        return self._tag

    @staticmethod
    def helper() -> str:
        return "Config.helper"

    @classmethod
    def default(cls) -> "Config":
        return cls("default")


class Factory:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg

    @classmethod
    def from_config(cls, cfg: Config) -> "Factory":
        return cls(cfg)

    def build(self) -> str:
        return "Factory(" + self.cfg.tag + ")"


class Depot:
    """A LIBRARY property whose getter returns a LIBRARY class, and one returning a
    library CONTAINER. `Depot().factory.build()` is the boundary form of the
    framework-accessor idiom that issue #286 measures on the client side."""

    def __init__(self) -> None:
        self._factory = Factory(Config("reg"))
        self._all = [Factory(Config("a")), Factory(Config("b"))]

    @property
    def factory(self) -> Factory:
        return self._factory

    @property
    def factories(self) -> List["Factory"]:
        return self._all
