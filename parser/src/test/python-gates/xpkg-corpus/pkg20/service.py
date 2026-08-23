import pkg20.impl
from pkg20 import build20
from pkg19.base import Base19 as Alias19
from .util import combine
from pkg20.impl import *


class Service20:
    def __init__(self):
        self.items = []
        self.primary: Alias19 = build20(21)

    def add(self, item: Alias19) -> "Service20":
        self.items.append(item)
        return self

    def seed(self) -> "Service20":
        return self.add(pkg20.impl.Impl20_1(2)).add(build20(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias19.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias19.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service20()


def run20() -> list:
    service = Service20()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
