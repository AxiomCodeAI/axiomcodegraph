from config import defaults


def test_defaults():
    assert defaults()["level"] == 3
