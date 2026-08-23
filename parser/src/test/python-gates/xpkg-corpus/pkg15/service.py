import pkg15.impl
from pkg15 import build15
from pkg14.base import Base14 as Alias14
from .util import combine
from pkg15.impl import *


class Service15:
    def __init__(self):
        self.items = []
        self.primary: Alias14 = build15(16)

    def add(self, item: Alias14) -> "Service15":
        self.items.append(item)
        return self

    def seed(self) -> "Service15":
        return self.add(pkg15.impl.Impl15_1(2)).add(build15(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias14.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias14.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service15()


def run15() -> list:
    service = Service15()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
