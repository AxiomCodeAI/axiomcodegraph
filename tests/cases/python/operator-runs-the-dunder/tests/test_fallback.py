from app.shapes import Fallback


def test_fallback():
    value = None or Fallback()
    assert value is not None
