import pkg08.impl
from pkg08 import build08
from pkg07.base import Base07 as Alias07
from .util import combine
from pkg08.impl import *


class Service08:
    def __init__(self):
        self.items = []
        self.primary: Alias07 = build08(9)

    def add(self, item: Alias07) -> "Service08":
        self.items.append(item)
        return self

    def seed(self) -> "Service08":
        return self.add(pkg08.impl.Impl08_1(2)).add(build08(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias07.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias07.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service08()


def run08() -> list:
    service = Service08()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
