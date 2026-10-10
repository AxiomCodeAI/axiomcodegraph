from app.store import Flat


def test_flat():
    assert Flat().get("a") == "a"
