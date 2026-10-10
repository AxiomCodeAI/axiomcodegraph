"""A factory whose class parameter defaults to None: the body puts the default class in and constructs it."""
import typing as t


class Command:
    def __init__(self, name):
        self.name = name


class Group(Command):
    pass


CmdType = t.TypeVar("CmdType", bound=Command)


def command(name, cls: type[CmdType] | None = None):
    if cls is None:
        cls = t.cast("type[CmdType]", Command)

    def decorator(f):
        return cls(name)
    return decorator


def option(name, cls: t.Optional[t.Type[Command]] = None):
    return (cls or Command)(name)


def fixed(name, cls: type[Command]):
    return cls(name)
