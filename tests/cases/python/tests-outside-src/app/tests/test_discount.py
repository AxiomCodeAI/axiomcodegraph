from app.pricing import discount


def test_discount():
    assert discount(5) == 4
