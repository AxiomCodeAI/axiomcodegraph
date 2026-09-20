"""A test beside the root conftest. It reaches the ROOT `layered`, nothing nearer.

It is also the case that a strict `>` on the conftest basename would break: this file
and conftest.py share a directory, so the governed prefix is the empty string.
"""


def test_root_level(layered, shared_db):
    return (layered, shared_db)
