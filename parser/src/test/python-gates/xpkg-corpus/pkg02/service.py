import pkg02.impl
from pkg02 import build02
from pkg01.base import Base01 as Alias01
from .util import combine
from pkg02.impl import *


class Service02:
    def __init__(self):
        self.items = []
        self.primary: Alias01 = build02(3)

    def add(self, item: Alias01) -> "Service02":
        self.items.append(item)
        return self

    def seed(self) -> "Service02":
        return self.add(pkg02.impl.Impl02_1(2)).add(build02(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias01.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias01.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service02()


def run02() -> list:
    service = Service02()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
