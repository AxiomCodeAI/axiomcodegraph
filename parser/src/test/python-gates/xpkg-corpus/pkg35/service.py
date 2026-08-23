import pkg35.impl
from pkg35 import build35
from pkg34.base import Base34 as Alias34
from .util import combine
from pkg35.impl import *


class Service35:
    def __init__(self):
        self.items = []
        self.primary: Alias34 = build35(36)

    def add(self, item: Alias34) -> "Service35":
        self.items.append(item)
        return self

    def seed(self) -> "Service35":
        return self.add(pkg35.impl.Impl35_1(2)).add(build35(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias34.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias34.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service35()


def run35() -> list:
    service = Service35()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
