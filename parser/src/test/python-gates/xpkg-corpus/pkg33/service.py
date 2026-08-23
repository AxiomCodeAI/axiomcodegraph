import pkg33.impl
from pkg33 import build33
from pkg32.base import Base32 as Alias32
from .util import combine
from pkg33.impl import *


class Service33:
    def __init__(self):
        self.items = []
        self.primary: Alias32 = build33(34)

    def add(self, item: Alias32) -> "Service33":
        self.items.append(item)
        return self

    def seed(self) -> "Service33":
        return self.add(pkg33.impl.Impl33_1(2)).add(build33(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias32.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias32.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service33()


def run33() -> list:
    service = Service33()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
