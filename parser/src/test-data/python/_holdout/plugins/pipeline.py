"""Locals reassigned across branches, and a callable held in a dict."""
from engine.events import Channel, Event
from plugins.registry import Plugin, make_channel


def build(name, verbose):
    # branch-dependent local: two in-root types flow into one name
    sink = make_channel(name)
    if verbose:
        sink = Channel(name + "-v")
    sink.push(Event("start", name))
    return sink


def run(name):
    plugin = Plugin(name)
    plugin.emit("go")
    return plugin.flush()


def tabled(name):
    # a dict of in-root callables; the value is invoked immediately
    table = {"build": build, "run": run}
    return table["run"](name)


def reuse(name):
    channel = build(name, False)
    drained = channel.drain()
    return drained
