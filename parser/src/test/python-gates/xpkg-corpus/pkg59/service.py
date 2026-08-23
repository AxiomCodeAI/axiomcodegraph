import pkg59.impl
from pkg59 import build59
from pkg58.base import Base58 as Alias58
from .util import combine
from pkg59.impl import *


class Service59:
    def __init__(self):
        self.items = []
        self.primary: Alias58 = build59(60)

    def add(self, item: Alias58) -> "Service59":
        self.items.append(item)
        return self

    def seed(self) -> "Service59":
        return self.add(pkg59.impl.Impl59_1(2)).add(build59(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias58.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias58.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service59()


def run59() -> list:
    service = Service59()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
