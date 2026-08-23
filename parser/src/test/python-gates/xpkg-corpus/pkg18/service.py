import pkg18.impl
from pkg18 import build18
from pkg18.base import Base18 as Alias18
from .util import combine
from pkg18.impl import *


class Service18:
    def __init__(self):
        self.items = []
        self.primary: Alias18 = build18(19)

    def add(self, item: Alias18) -> "Service18":
        self.items.append(item)
        return self

    def seed(self) -> "Service18":
        return self.add(pkg18.impl.Impl18_1(2)).add(build18(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias18.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias18.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service18()


def run18() -> list:
    service = Service18()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
