import pkg46.impl
from pkg46 import build46
from pkg45.base import Base45 as Alias45
from .util import combine
from pkg46.impl import *


class Service46:
    def __init__(self):
        self.items = []
        self.primary: Alias45 = build46(47)

    def add(self, item: Alias45) -> "Service46":
        self.items.append(item)
        return self

    def seed(self) -> "Service46":
        return self.add(pkg46.impl.Impl46_1(2)).add(build46(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias45.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias45.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service46()


def run46() -> list:
    service = Service46()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
