from lib import total


# a helper the tests import, named like a test: pytest collects nothing from helpers.py
def testing_app():
    return total()
