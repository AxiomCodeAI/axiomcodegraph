from app.validators import Plain, Shown


def test_str_falls_back():
    assert str(Plain()) == "plain"


def test_str_own():
    assert str(Shown()) == "shown"
