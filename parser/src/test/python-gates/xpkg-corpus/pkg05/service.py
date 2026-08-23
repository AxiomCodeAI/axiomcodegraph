import pkg05.impl
from pkg05 import build05
from pkg04.base import Base04 as Alias04
from .util import combine
from pkg05.impl import *


class Service05:
    def __init__(self):
        self.items = []
        self.primary: Alias04 = build05(6)

    def add(self, item: Alias04) -> "Service05":
        self.items.append(item)
        return self

    def seed(self) -> "Service05":
        return self.add(pkg05.impl.Impl05_1(2)).add(build05(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias04.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias04.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service05()


def run05() -> list:
    service = Service05()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
