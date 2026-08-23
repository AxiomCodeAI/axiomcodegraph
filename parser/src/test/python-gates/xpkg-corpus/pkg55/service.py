import pkg55.impl
from pkg55 import build55
from pkg54.base import Base54 as Alias54
from .util import combine
from pkg55.impl import *


class Service55:
    def __init__(self):
        self.items = []
        self.primary: Alias54 = build55(56)

    def add(self, item: Alias54) -> "Service55":
        self.items.append(item)
        return self

    def seed(self) -> "Service55":
        return self.add(pkg55.impl.Impl55_1(2)).add(build55(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias54.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias54.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service55()


def run55() -> list:
    service = Service55()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
