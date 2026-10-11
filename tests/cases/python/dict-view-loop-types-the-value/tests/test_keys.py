from app.schema import Schema


def test_keys():
    assert Schema().keys_only() == []


def test_counts():
    assert Schema().counts() == 0
