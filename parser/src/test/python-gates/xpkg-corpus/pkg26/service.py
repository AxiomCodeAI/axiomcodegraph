import pkg26.impl
from pkg26 import build26
from pkg25.base import Base25 as Alias25
from .util import combine
from pkg26.impl import *


class Service26:
    def __init__(self):
        self.items = []
        self.primary: Alias25 = build26(27)

    def add(self, item: Alias25) -> "Service26":
        self.items.append(item)
        return self

    def seed(self) -> "Service26":
        return self.add(pkg26.impl.Impl26_1(2)).add(build26(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias25.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias25.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service26()


def run26() -> list:
    service = Service26()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
