import pkg58.impl
from pkg58 import build58
from pkg57.base import Base57 as Alias57
from .util import combine
from pkg58.impl import *


class Service58:
    def __init__(self):
        self.items = []
        self.primary: Alias57 = build58(59)

    def add(self, item: Alias57) -> "Service58":
        self.items.append(item)
        return self

    def seed(self) -> "Service58":
        return self.add(pkg58.impl.Impl58_1(2)).add(build58(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias57.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias57.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service58()


def run58() -> list:
    service = Service58()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
