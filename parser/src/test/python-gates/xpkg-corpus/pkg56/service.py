import pkg56.impl
from pkg56 import build56
from pkg55.base import Base55 as Alias55
from .util import combine
from pkg56.impl import *


class Service56:
    def __init__(self):
        self.items = []
        self.primary: Alias55 = build56(57)

    def add(self, item: Alias55) -> "Service56":
        self.items.append(item)
        return self

    def seed(self) -> "Service56":
        return self.add(pkg56.impl.Impl56_1(2)).add(build56(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias55.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias55.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service56()


def run56() -> list:
    service = Service56()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
