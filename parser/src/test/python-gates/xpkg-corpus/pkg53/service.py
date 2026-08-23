import pkg53.impl
from pkg53 import build53
from pkg52.base import Base52 as Alias52
from .util import combine
from pkg53.impl import *


class Service53:
    def __init__(self):
        self.items = []
        self.primary: Alias52 = build53(54)

    def add(self, item: Alias52) -> "Service53":
        self.items.append(item)
        return self

    def seed(self) -> "Service53":
        return self.add(pkg53.impl.Impl53_1(2)).add(build53(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias52.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias52.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service53()


def run53() -> list:
    service = Service53()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
