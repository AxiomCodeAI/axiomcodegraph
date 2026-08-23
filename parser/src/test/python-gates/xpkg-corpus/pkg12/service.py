import pkg12.impl
from pkg12 import build12
from pkg12.base import Base12 as Alias12
from .util import combine
from pkg12.impl import *


class Service12:
    def __init__(self):
        self.items = []
        self.primary: Alias12 = build12(13)

    def add(self, item: Alias12) -> "Service12":
        self.items.append(item)
        return self

    def seed(self) -> "Service12":
        return self.add(pkg12.impl.Impl12_1(2)).add(build12(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias12.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias12.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service12()


def run12() -> list:
    service = Service12()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
