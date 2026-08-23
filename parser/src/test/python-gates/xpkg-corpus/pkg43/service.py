import pkg43.impl
from pkg43 import build43
from pkg42.base import Base42 as Alias42
from .util import combine
from pkg43.impl import *


class Service43:
    def __init__(self):
        self.items = []
        self.primary: Alias42 = build43(44)

    def add(self, item: Alias42) -> "Service43":
        self.items.append(item)
        return self

    def seed(self) -> "Service43":
        return self.add(pkg43.impl.Impl43_1(2)).add(build43(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias42.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias42.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service43()


def run43() -> list:
    service = Service43()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
