from app import create_order


def test_create_order():
    assert create_order("o-1")["limit"] == 10
