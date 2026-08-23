import pkg03.impl
from pkg03 import build03
from pkg02.base import Base02 as Alias02
from .util import combine
from pkg03.impl import *


class Service03:
    def __init__(self):
        self.items = []
        self.primary: Alias02 = build03(4)

    def add(self, item: Alias02) -> "Service03":
        self.items.append(item)
        return self

    def seed(self) -> "Service03":
        return self.add(pkg03.impl.Impl03_1(2)).add(build03(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias02.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias02.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service03()


def run03() -> list:
    service = Service03()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
