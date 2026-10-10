from app.store import Store


def test_get():
    assert Store().get("a") == "A"
