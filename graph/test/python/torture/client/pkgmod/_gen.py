"""The imported member is a GENERATOR on purpose.

`resolvedTargetKind` never carries GENERATOR, so the parser's FK path declines and the
name-based path is the ONLY thing that can bind the name. With a plain function the FK
path covers for a broken name path and the fixture would pass either way."""


def each(values):
    for v in values:
        yield v


def each_first(values):
    for v in values:
        yield v
        return


def plain(values):
    """A non-generator control: this one the FK path resolves on its own, so if `each`
    misses while `plain` hits, the failure is isolated to the name path."""
    return list(values)
