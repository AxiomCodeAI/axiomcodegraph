from app import record


def test_record():
    assert record("x") == ["open"]
