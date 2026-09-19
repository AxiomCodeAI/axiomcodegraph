"""A decorator the project declares itself, and the table it writes into.

Nothing calls `export_csv` by name and nothing calls `exporter` from a call site: the
only thing linking a handler to its decorator is the `@` line above it.
"""
EXPORTERS = {}


def exporter(name):
    def register(fn):
        EXPORTERS[name] = fn
        return fn
    return register


@exporter("csv")
def export_csv(order):
    return ",".join(order)


def plain(order):
    """Decorated by nothing: a change to `exporter` cannot reach it."""
    return list(order)


def export(order, kind):
    return EXPORTERS[kind](order)
