"""A module of its own, importing nothing from app.

In Python a sibling in the SAME file is not a control: whatever the module runs at import
reaches every test that imports it, decorator or no decorator. The control has to be a
module that does not import the one under test.
"""


def plain(order):
    return list(order)
