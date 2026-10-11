from app.schema import Schema


def test_dump():
    assert Schema().dump(1) == {}
