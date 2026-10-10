from app.validators import Bag


def test_len():
    assert len(Bag()) == 3
    assert bool(Bag())
