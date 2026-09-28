from lib import Orders


def test_totals():
    assert Orders().totals([1, -1]) == [2]


def test_names():
    assert Orders().names() == []
