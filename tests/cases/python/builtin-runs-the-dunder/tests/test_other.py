from app.validators import Shown


def test_other():
    assert Shown() is not None
