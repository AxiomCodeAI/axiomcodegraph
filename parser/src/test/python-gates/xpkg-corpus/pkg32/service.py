import pkg32.impl
from pkg32 import build32
from pkg31.base import Base31 as Alias31
from .util import combine
from pkg32.impl import *


class Service32:
    def __init__(self):
        self.items = []
        self.primary: Alias31 = build32(33)

    def add(self, item: Alias31) -> "Service32":
        self.items.append(item)
        return self

    def seed(self) -> "Service32":
        return self.add(pkg32.impl.Impl32_1(2)).add(build32(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias31.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias31.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service32()


def run32() -> list:
    service = Service32()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
