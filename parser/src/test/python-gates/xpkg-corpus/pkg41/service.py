import pkg41.impl
from pkg41 import build41
from pkg40.base import Base40 as Alias40
from .util import combine
from pkg41.impl import *


class Service41:
    def __init__(self):
        self.items = []
        self.primary: Alias40 = build41(42)

    def add(self, item: Alias40) -> "Service41":
        self.items.append(item)
        return self

    def seed(self) -> "Service41":
        return self.add(pkg41.impl.Impl41_1(2)).add(build41(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias40.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias40.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service41()


def run41() -> list:
    service = Service41()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
