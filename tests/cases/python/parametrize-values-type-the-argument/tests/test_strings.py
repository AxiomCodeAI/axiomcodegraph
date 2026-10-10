import pytest


@pytest.mark.parametrize("name", ["Unused", "String"])
def test_names(name):
    assert name.upper()
