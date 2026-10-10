from app.schema import emit


def test_emit():
    assert emit() == "h"
