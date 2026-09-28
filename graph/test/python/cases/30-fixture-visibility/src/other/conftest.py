"""A sibling directory's conftest, star-importing its own fixture module by its
ABSOLUTE name (tests/conftest.py uses the relative spelling)."""
from other.more_fixtures import *
