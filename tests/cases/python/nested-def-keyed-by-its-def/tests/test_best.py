from app.service import best


def test_best():
    assert best([1, 2]) == 1
