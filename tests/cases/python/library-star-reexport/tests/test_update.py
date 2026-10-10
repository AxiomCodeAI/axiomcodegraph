from app.store import Store


def test_update():
    Store().update({"A": 1})
