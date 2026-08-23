import pkg37.impl
from pkg37 import build37
from pkg36.base import Base36 as Alias36
from .util import combine
from pkg37.impl import *


class Service37:
    def __init__(self):
        self.items = []
        self.primary: Alias36 = build37(38)

    def add(self, item: Alias36) -> "Service37":
        self.items.append(item)
        return self

    def seed(self) -> "Service37":
        return self.add(pkg37.impl.Impl37_1(2)).add(build37(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias36.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias36.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service37()


def run37() -> list:
    service = Service37()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
