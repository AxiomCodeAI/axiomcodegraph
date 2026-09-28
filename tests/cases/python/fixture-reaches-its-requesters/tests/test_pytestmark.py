import pytest

pytestmark = pytest.mark.usefixtures("cleandir")


def test_module_marker():
    assert True
