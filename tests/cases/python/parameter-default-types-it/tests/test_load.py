from app.schema import load


def test_load():
    assert load(1) == ["d"]
