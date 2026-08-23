import pkg16.impl
from pkg16 import build16
from pkg15.base import Base15 as Alias15
from .util import combine
from pkg16.impl import *


class Service16:
    def __init__(self):
        self.items = []
        self.primary: Alias15 = build16(17)

    def add(self, item: Alias15) -> "Service16":
        self.items.append(item)
        return self

    def seed(self) -> "Service16":
        return self.add(pkg16.impl.Impl16_1(2)).add(build16(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias15.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias15.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service16()


def run16() -> list:
    service = Service16()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
