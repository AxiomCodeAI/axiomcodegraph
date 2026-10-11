from app.shapes import Batch, Sized


def test_batch():
    if Batch():
        return
    raise AssertionError


def test_sized():
    assert Sized()
