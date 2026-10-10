from app.schema import Schema


def test_load():
    assert Schema().load(1) == []
