import pkg50.impl
from pkg50 import build50
from pkg49.base import Base49 as Alias49
from .util import combine
from pkg50.impl import *


class Service50:
    def __init__(self):
        self.items = []
        self.primary: Alias49 = build50(51)

    def add(self, item: Alias49) -> "Service50":
        self.items.append(item)
        return self

    def seed(self) -> "Service50":
        return self.add(pkg50.impl.Impl50_1(2)).add(build50(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias49.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias49.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service50()


def run50() -> list:
    service = Service50()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
