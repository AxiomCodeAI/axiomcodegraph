import pkg28.impl
from pkg28 import build28
from pkg27.base import Base27 as Alias27
from .util import combine
from pkg28.impl import *


class Service28:
    def __init__(self):
        self.items = []
        self.primary: Alias27 = build28(29)

    def add(self, item: Alias27) -> "Service28":
        self.items.append(item)
        return self

    def seed(self) -> "Service28":
        return self.add(pkg28.impl.Impl28_1(2)).add(build28(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias27.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias27.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service28()


def run28() -> list:
    service = Service28()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
