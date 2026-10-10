from app.shapes import Strategy


def test_compose():
    assert Strategy() | Strategy() == 7
