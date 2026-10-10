from app import lookup


def test_lookup():
    assert lookup("default")() == "default"
