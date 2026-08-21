"""Polymorphism and inheritance shapes."""
import abc


class Root:
    def shared(self):
        return "root"

    def only_root(self):
        return "root"


class LeftMid(Root):
    def shared(self):
        return "left"


class RightMid(Root):
    def shared(self):
        return "right"

    def only_right(self):
        return "right"


class Diamond(LeftMid, RightMid):
    """C3: Diamond, LeftMid, RightMid, Root — shared comes from LeftMid."""


class DeepChain(Diamond):
    def deep(self):
        return super().shared()


class Mixin:
    def mixed(self):
        return "mixin"


class WithMixin(Mixin, Root):
    """Mixin first, so `mixed` resolves to Mixin and `shared` to Root."""


class AbstractBase(abc.ABC):
    @abc.abstractmethod
    def must_impl(self):
        ...

    def concrete(self):
        return self.must_impl()


class Impl(AbstractBase):
    def must_impl(self):
        return "impl"


class Overrider(Impl):
    def must_impl(self):
        return "overridden"
