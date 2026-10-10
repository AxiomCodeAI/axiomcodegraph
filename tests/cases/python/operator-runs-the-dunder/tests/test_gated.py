from app.shapes import Gated


def test_gated():
    if not Gated():
        raise AssertionError
