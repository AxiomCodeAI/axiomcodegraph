import pkg29.impl
from pkg29 import build29
from pkg28.base import Base28 as Alias28
from .util import combine
from pkg29.impl import *


class Service29:
    def __init__(self):
        self.items = []
        self.primary: Alias28 = build29(30)

    def add(self, item: Alias28) -> "Service29":
        self.items.append(item)
        return self

    def seed(self) -> "Service29":
        return self.add(pkg29.impl.Impl29_1(2)).add(build29(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias28.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias28.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service29()


def run29() -> list:
    service = Service29()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
