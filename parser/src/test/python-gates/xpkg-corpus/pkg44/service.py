import pkg44.impl
from pkg44 import build44
from pkg43.base import Base43 as Alias43
from .util import combine
from pkg44.impl import *


class Service44:
    def __init__(self):
        self.items = []
        self.primary: Alias43 = build44(45)

    def add(self, item: Alias43) -> "Service44":
        self.items.append(item)
        return self

    def seed(self) -> "Service44":
        return self.add(pkg44.impl.Impl44_1(2)).add(build44(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias43.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias43.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service44()


def run44() -> list:
    service = Service44()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
