import pytest

from app.fields import Box


@pytest.mark.parametrize("label, box", [("a", Box()), pytest.param("b", Box(), id="b")])
def test_open(label, box):
    assert box.open()
