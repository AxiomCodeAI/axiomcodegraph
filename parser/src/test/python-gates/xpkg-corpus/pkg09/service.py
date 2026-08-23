import pkg09.impl
from pkg09 import build09
from pkg08.base import Base08 as Alias08
from .util import combine
from pkg09.impl import *


class Service09:
    def __init__(self):
        self.items = []
        self.primary: Alias08 = build09(10)

    def add(self, item: Alias08) -> "Service09":
        self.items.append(item)
        return self

    def seed(self) -> "Service09":
        return self.add(pkg09.impl.Impl09_1(2)).add(build09(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias08.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias08.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service09()


def run09() -> list:
    service = Service09()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
