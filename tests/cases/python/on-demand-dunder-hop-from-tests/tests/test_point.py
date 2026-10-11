from pkg.model import Point


def test_repr():
    assert repr(Point(1, 2)) == "Point(1, 2)"
