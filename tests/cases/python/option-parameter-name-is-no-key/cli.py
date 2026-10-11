"""A command whose decorations declare its parameters: the flags are what a caller writes, the last name is the
parameter the value is bound to."""


def option(*decls, **settings):
    def attach(fn):
        return fn
    return attach


@option("--level", "-l", "level", type=int)
def main(level=0):
    return describe(level)


def describe(level):
    return level
