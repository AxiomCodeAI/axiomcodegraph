import pytest

pytestmark = pytest.mark.usefixtures("service")


def test_marks_plugin_fixture():
    assert True
