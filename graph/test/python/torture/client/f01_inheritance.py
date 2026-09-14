"""FAMILY 01 — inheritance & MRO, client->lib and client->client."""
from tlib import Base, Circle, Diamond, Leaf, Square


class LocalBase:
    def kind(self) -> str:
        return "LocalBase"


class LocalMid(LocalBase):
    pass


class LocalLeaf(LocalMid):
    def kind(self) -> str:
        return "LocalLeaf"


def lib_deep_chain() -> str:
    obj = Leaf()                       # -> lib Leaf.__init__ (inherited object)
    return obj.name() + obj.only_base() + obj.via_super()


def lib_template_method() -> str:
    return Square().template() + Circle().template()


def lib_diamond() -> str:
    return Diamond().name() + Diamond().both()


def client_chain() -> str:
    return LocalLeaf().kind() + LocalMid().kind()


def virtual_over_constructed() -> str:
    out = []
    for s in (Square(), Circle()):      # receiver typed only by construction set
        out.append(s.name())
    return "".join(out)
