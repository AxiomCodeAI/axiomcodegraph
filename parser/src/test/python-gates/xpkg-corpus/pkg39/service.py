import pkg39.impl
from pkg39 import build39
from pkg38.base import Base38 as Alias38
from .util import combine
from pkg39.impl import *


class Service39:
    def __init__(self):
        self.items = []
        self.primary: Alias38 = build39(40)

    def add(self, item: Alias38) -> "Service39":
        self.items.append(item)
        return self

    def seed(self) -> "Service39":
        return self.add(pkg39.impl.Impl39_1(2)).add(build39(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias38.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias38.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service39()


def run39() -> list:
    service = Service39()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
