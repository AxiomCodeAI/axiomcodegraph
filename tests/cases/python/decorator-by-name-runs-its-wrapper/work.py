"""The decorator is reached through a value the graph cannot type, so the decoration is matched by its name."""
from loader import load

tools = load()


@tools.timed
def crunch_numbers(n):
    return n * 2


def run_crunch():
    return crunch_numbers(3)
