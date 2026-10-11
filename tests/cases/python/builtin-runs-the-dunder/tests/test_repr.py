from app.validators import instance_of


def test_repr():
    v = instance_of(int)
    assert repr(v) == "<instance_of int>"
