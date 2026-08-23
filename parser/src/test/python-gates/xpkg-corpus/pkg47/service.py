import pkg47.impl
from pkg47 import build47
from pkg46.base import Base46 as Alias46
from .util import combine
from pkg47.impl import *


class Service47:
    def __init__(self):
        self.items = []
        self.primary: Alias46 = build47(48)

    def add(self, item: Alias46) -> "Service47":
        self.items.append(item)
        return self

    def seed(self) -> "Service47":
        return self.add(pkg47.impl.Impl47_1(2)).add(build47(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias46.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias46.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service47()


def run47() -> list:
    service = Service47()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
